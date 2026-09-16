/**
 * Command line entry point.
 *
 * The important one is the dry run: it builds a real post, renders a real
 * meme, prints both, and publishes nothing. Use it until the output looks
 * right, then flip DRY_RUN to false.
 *
 *   npm run dry-run              build one post, publish nothing
 *   npm run dry-run -- --count=6 build six, one per post shape
 *   npm run run:once             build one post and publish it
 *   npm run templates:preview    render every meme template to data/out
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createAgent } from './agent.js';
import { createLinkedInProvider } from './publisher/linkedin-provider.js';
import { createPipeline } from './pipeline.js';
import { describeCron } from './scheduler/index.js';

const [, , command = 'run', ...flags] = process.argv;
const holdBack = flags.includes('--dry-run');

/**
 * How many posts to build in one go. Handy with --dry-run for seeing several
 * shapes back to back, since the shape rotation only advances one per post.
 */
const count = Number(flags.find((flag) => flag.startsWith('--count='))?.split('=')[1] ?? 1) || 1;

function line(char = '-') {
  console.log(char.repeat(72));
}

/** Print one finished post the way a human wants to review it. */
function showPost(post) {
  line('=');
  console.log(`POST ${post.id}   status: ${post.status}`);
  console.log(`Story: ${post.articleTitle}`);
  console.log(`       ${post.articleUrl}`);
  line();
  console.log(`Why this story: ${post.curationReason || '(heuristic pick)'}`);
  console.log(`Angle:          ${post.angle || '(none given)'}`);
  console.log(`Post shape:     ${post.shape}`);
  console.log(`Opening style:  ${post.openingStyle}`);
  console.log(`Meme template:  ${post.memeTemplate}`);
  console.log(`Meme image:     ${post.memePath}`);
  line();
  console.log(post.text);
  line();

  const scoreboard = post.hookScoreboard ?? [];
  if (scoreboard.length) {
    console.log('Hook candidates, best first:');
    for (const entry of scoreboard) {
      const notes = entry.notes.length ? `  (${entry.notes.join('; ')})` : '';
      console.log(`  ${entry.score.toFixed(2)}  ${entry.hook}${notes}`);
    }
  }

  const tells = post.humanizerReport?.remainingTells ?? post.humanizerReport?.secondPass?.remainingTells ?? [];
  console.log(tells.length
    ? `\nAI tells still present: ${tells.map((tell) => `${tell.type} (${tell.detail})`).join(', ')}`
    : '\nAI tells still present: none');

  line('=');
}

async function runCommand() {
  const agent = await createAgent();
  const pipeline = createPipeline(agent);

  if (holdBack || agent.config.dryRun) {
    console.log('\nDRY RUN. Nothing will be published.\n');
  }

  const result = await pipeline.run({ count, publish: !holdBack });

  if (result.skipped) {
    console.log(`\nNothing to do: ${result.skipped}\n`);
    return;
  }

  for (const post of result.posts) showPost(post);

  const usage = result.usage;
  console.log(`LLM: ${usage.calls} calls, ${usage.inputTokens} in / ${usage.outputTokens} out, about $${usage.costUsd.toFixed(4)}`);
  console.log(`Schedule: ${describeCron(agent.config.schedule.cron)} ${agent.config.schedule.timezone}\n`);
}

/** Render every template once so you can see the whole rotation at a glance. */
async function previewTemplatesCommand() {
  const agent = await createAgent();
  const names = await agent.memeGenerator.listTemplates();

  console.log(`Rendering ${names.length} templates into ${agent.config.paths.output}\n`);

  for (const name of names) {
    const file = path.join(agent.config.paths.output, `template-${name}.png`);

    await agent.memeGenerator.renderToFile({
      topText: 'We replaced the intern with an agent',
      bottomText: 'The agent opened 400 pull requests',
      footer: agent.config.memeGenerator.footer,
      templateName: name,
    }, file);

    console.log(`  ${name.padEnd(20)} ${file}`);
  }

  console.log('');
}

/**
 * Publish one draft that already exists, by id.
 *
 * This is the safe way to make your first real post: run a dry run, read what
 * it wrote, and then send that exact draft. `run` would generate a fresh post
 * and publish it before you ever saw it.
 *
 * It ignores DRY_RUN on purpose, because naming a specific draft and adding
 * --confirm is about as explicit as intent gets. Without --confirm it only
 * prints the post and stops.
 */
async function publishCommand() {
  const postId = flags.find((flag) => !flag.startsWith('--'));
  const confirmed = flags.includes('--confirm');

  const agent = await createAgent();

  if (!postId) {
    const drafts = (await agent.store.listPosts(10)).filter((p) => p.status === 'draft');

    console.log(drafts.length ? '\nDrafts you can publish:\n' : '\nNo drafts yet. Run: npm run dry-run\n');

    for (const draft of drafts) {
      console.log(`  ${draft.id}   ${draft.hook.slice(0, 60)}`);
    }

    console.log(`\nThen: npm run publish -- <id> --confirm\n`);
    return;
  }

  const post = await agent.store.getPost(postId);

  if (!post) {
    console.error(`\nNo post with id "${postId}". Run: npm run publish\n`);
    process.exit(1);
  }

  if (post.status === 'published') {
    console.error(`\nThat post is already on LinkedIn: ${post.providerUrl ?? post.providerPostId}\n`);
    process.exit(1);
  }

  showPost(post);

  const settings = agent.config.publisher.linkedin;

  if (!settings.accessToken || !settings.memberId) {
    console.error('LINKEDIN_ACCESS_TOKEN or LINKEDIN_MEMBER_ID is missing. Run: npm run linkedin:auth\n');
    process.exit(1);
  }

  if (!confirmed) {
    console.log(`This is a DRY PRINT. Nothing was sent.

To actually put this on your LinkedIn profile:

  npm run publish -- ${post.id} --confirm
`);
    return;
  }

  // Send it for real.
  const provider = createLinkedInProvider({ settings });

  const who = await provider.verify();
  console.log(`Posting as ${who.name} (${who.memberId})...`);

  let imageBuffer;
  try {
    imageBuffer = await fs.readFile(post.memePath);
  } catch {
    console.log('Meme image is missing, posting text only.');
  }

  const result = await provider.publish({
    text: post.text,
    imageBuffer,
    imageAltText: `Meme about: ${post.articleTitle}`,
  });

  await agent.store.updatePost(post.id, {
    status: 'published',
    publishedAt: new Date().toISOString(),
    providerPostId: result.providerPostId,
    providerUrl: result.url,
  });

  // Never post about the same story twice.
  await agent.store.updateArticle(post.articleId, { usedInPostId: post.id });

  console.log(`
Published.

  Post id  ${result.providerPostId ?? '(not returned)'}
  Link     ${result.url ?? 'check your profile'}

Go and look at it. Check the line breaks, the hashtags, and that there are
no stray backslashes in the text.
`);
}

const COMMANDS = {
  run: runCommand,
  publish: publishCommand,
  'preview-templates': previewTemplatesCommand,
};

const handler = COMMANDS[command];

if (!handler) {
  console.error(`Unknown command "${command}". Try: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}

await handler();
process.exit(0);
