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
import { createAgent, assertStoreCanRecordLivePosts } from './agent.js';
import { createLinkedInProvider } from './publisher/linkedin-provider.js';
import { createPipeline } from './pipeline.js';
import { describeCron } from './scheduler/index.js';
import { isTextOnly } from './meme-generator/media.js';

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
  if (post.quality) {
    const mark = post.needsReview ? 'HELD' : 'ok';
    console.log(`Quality:        ${post.quality.score ?? 'n/a'}/5 ${mark} - ${post.quality.verdict}`);
    for (const problem of post.quality.problems ?? []) console.log(`                - ${problem}`);
  }
  console.log(`Why this story: ${post.curationReason || '(heuristic pick)'}`);
  console.log(`Angle:          ${post.angle || '(none given)'}`);
  console.log(`Frame:          ${post.frame ?? '(none)'}`);
  console.log(`Post shape:     ${post.shape}`);
  console.log(`Opening style:  ${post.openingStyle}`);
  console.log(`Ends with:      ${post.closerStyle ?? '(the shape ends itself)'}`);
  console.log(`Length:         ${post.words} words, ${post.lengthMood} (aimed for ${post.targetWords})`);
  console.log(`Media:          ${post.mediaTreatment ?? 'meme-square'}`);
  console.log(post.memePath
    ? `Meme template:  ${post.memeTemplate} (${post.memeLayout} layout)\nMeme image:     ${post.memePath}`
    : 'Meme template:  none, this post is text-only');
  line();
  console.log(post.text);
  line();

  const scoreboard = post.hookScoreboard ?? [];
  if (scoreboard.length) {
    console.log('Hook candidates, best first ( > is the one that ran):');
    for (const entry of scoreboard) {
      const notes = entry.notes.length ? `  (${entry.notes.join('; ')})` : '';
      console.log(`${entry.chosen ? ' >' : '  '} ${entry.score.toFixed(2)}  ${entry.hook}${notes}`);
    }
  }

  const tagReasons = post.hashtagReasons ?? [];
  if (tagReasons.length) {
    console.log('\nHashtags, and why each one is here:');
    for (const entry of tagReasons) {
      console.log(`  ${entry.tag.padEnd(22)} ${entry.why} (used ${entry.uses}x recently)`);
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

  // Every picture treatment, so you can see the shapes as well as the colours.
  const treatments = agent.config.memeGenerator.treatments.filter((name) => !isTextOnly(name));

  console.log(`Rendering ${names.length} templates x ${treatments.length} sizes into ${agent.config.paths.output}\n`);

  for (const name of names) {
    for (const treatment of treatments) {
      const file = path.join(agent.config.paths.output, `template-${name}-${treatment}.png`);

      const rendered = await agent.memeGenerator.renderToFile({
        topText: 'We replaced the intern with an agent',
        bottomText: 'The agent opened 400 pull requests',
        footer: agent.config.memeGenerator.footer,
        templateName: name,
        treatment,
      }, file);

      console.log(`  ${name.padEnd(20)} ${rendered.layout.padEnd(11)} ${treatment.padEnd(14)} ${file}`);
    }
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

  // Publishing by hand is the path a rejected post is most likely to escape
  // through, so it is refused here too. --force is available and deliberate.
  if (post.needsReview && !flags.includes('--force')) {
    console.error(`\nThis post did not pass the quality gate, so it is on hold.\n`);
    console.error(`  score:   ${post.quality?.score ?? 'n/a'} of 5`);
    console.error(`  verdict: ${post.quality?.verdict ?? '(none)'}`);
    for (const problem of post.quality?.problems ?? []) console.error(`  - ${problem}`);
    console.error(`\nRun a fresh one with: npm run dry-run`);
    console.error(`Or send it anyway with: npm run publish -- ${post.id} --confirm --force\n`);
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

  // This command builds its own provider and ignores DRY_RUN, so the check in
  // createAgent() never sees it. That makes this the one path that could
  // still publish for real and record it somewhere Lambda cannot read - and
  // it is the path that actually did it, for the first post.
  assertStoreCanRecordLivePosts({
    config: { ...agent.config, dryRun: false },
    store: agent.store,
    publisher: { name: 'linkedin' },
  });

  // Send it for real.
  const provider = createLinkedInProvider({ settings });

  const who = await provider.verify();
  console.log(`Posting as ${who.name} (${who.memberId})...`);

  let imageBuffer;

  if (!post.memePath) {
    // Not a problem: text-only is one of the media treatments.
    console.log('This post is text-only by design. Posting without an image.');
  } else {
    try {
      imageBuffer = await fs.readFile(post.memePath);
    } catch {
      console.log('Meme image is missing, posting text only.');
    }
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

/**
 * Merge the local JSON store into DynamoDB.
 *
 * Needed once, because the agent spent its first week keeping two separate
 * memories: local runs wrote ./data, Lambda wrote DynamoDB, and neither knew
 * about the other's posts or rotation counters.
 *
 * Prints what it would do and stops. Pass --confirm to write.
 */
async function migrateStoreCommand() {
  const confirmed = flags.includes('--confirm');

  const { config } = await import('./config/index.js');
  const { createJsonDriver } = await import('./store/json-driver.js');
  const { createDynamoDriver } = await import('./store/dynamo-driver.js');
  const { migrateStore } = await import('./store/migrate.js');

  const source = createJsonDriver({ directory: config.paths.data });
  const target = createDynamoDriver({
    tableName: config.store.tableName,
    region: config.store.region,
  });

  console.log(`\n${config.paths.data}  ->  DynamoDB table "${config.store.tableName}" (${config.store.region})\n`);

  const summary = await migrateStore({ source, target, apply: confirmed });

  line();
  console.log(`Articles:  ${summary.articles.copied} to copy, ${summary.articles.skipped} already there`);
  console.log(`Posts:     ${summary.posts.copied} to copy, ${summary.posts.skipped} already there`);
  line();

  console.log('State:');
  for (const row of summary.state) {
    const mark = row.changed ? '*' : ' ';
    console.log(`  ${mark} ${row.key.padEnd(24)} ${JSON.stringify(row.from)} -> ${JSON.stringify(row.to)}   (${row.reason})`);
  }

  console.log(confirmed
    ? '\nDone. Local and Lambda now share one memory.\n'
    : '\nDRY RUN, nothing was written. To apply:\n\n  npm run store:migrate -- --confirm\n');
}

const COMMANDS = {
  run: runCommand,
  publish: publishCommand,
  'preview-templates': previewTemplatesCommand,
  'migrate-store': migrateStoreCommand,
};

const handler = COMMANDS[command];

if (!handler) {
  console.error(`Unknown command "${command}". Try: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}

await handler();
process.exit(0);
