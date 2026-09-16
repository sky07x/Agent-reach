/**
 * Single-table DynamoDB driver, used when the agent runs on Lambda.
 *
 * Table layout is deliberately boring:
 *   pk = collection name  ("articles", "posts", "state")
 *   sk = item id
 *
 * One partition per collection is fine at this volume. We write roughly a few
 * hundred small items a month, which sits inside the free tier.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

export function createDynamoDriver({ tableName, region }) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  /** Strip the keys we add, so callers only ever see their own fields. */
  function toItem(row) {
    if (!row) return null;
    const { pk, sk, ...rest } = row;
    return rest;
  }

  return {
    name: 'dynamo',

    async init() {
      // The table is created by infra (see infra/template.yaml), not here.
    },

    async get(collection, id) {
      const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { pk: collection, sk: id },
      }));
      return toItem(result.Item);
    },

    async put(collection, item) {
      const existing = await this.get(collection, item.id);

      await client.send(new PutCommand({
        TableName: tableName,
        Item: { ...(existing ?? {}), ...item, pk: collection, sk: item.id },
      }));

      return item;
    },

    async putMany(collection, items) {
      // BatchWrite caps at 25 items per call, so send it in chunks.
      for (let start = 0; start < items.length; start += 25) {
        const chunk = items.slice(start, start + 25);

        await client.send(new BatchWriteCommand({
          RequestItems: {
            [tableName]: chunk.map((item) => ({
              PutRequest: { Item: { ...item, pk: collection, sk: item.id } },
            })),
          },
        }));
      }

      return items;
    },

    async list(collection) {
      const rows = [];
      let startKey;

      do {
        const result = await client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': collection },
          ExclusiveStartKey: startKey,
        }));

        rows.push(...(result.Items ?? []).map(toItem));
        startKey = result.LastEvaluatedKey;
      } while (startKey);

      return rows;
    },

    async remove(collection, id) {
      await client.send(new DeleteCommand({
        TableName: tableName,
        Key: { pk: collection, sk: id },
      }));
    },
  };
}
