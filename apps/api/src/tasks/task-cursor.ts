import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Describes the sort key of the last task on a page.
 * @since REQ-004
 */
export interface TaskCursor {
  createdAt: Date;
  id: string;
}

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

/**
 * Encodes a task sort key as an opaque base64url cursor.
 * @since REQ-004
 */
export function encodeTaskCursor({ createdAt, id }: TaskCursor): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
}

/**
 * Decodes an opaque cursor back into a task sort key; throws 400 when it is malformed.
 * @since REQ-004
 */
export function decodeTaskCursor(cursor: string): TaskCursor {
  try {
    const [createdAt, id] = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { createdAt: new Date(createdAt), id };
  } catch {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: { cursor: ['Invalid cursor'] },
    });
  }
}
