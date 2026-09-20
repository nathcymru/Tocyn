import { expect, it } from 'vitest';
import { attachmentIconKind } from '../utils/attachment-icon-kind';

it.each([
  ['message.pdf', 'application/pdf', 'pdf'],
  ['message.pdf', 'image/png', 'image'],
  ['message.pdf', 'application/msword', 'generic'],
  ['PHOTO.JPEG', null, 'image'],
  ['bundle.zip', 'application/octet-stream', 'archive'],
  ['notes.md', 'text/markdown; charset=utf-8', 'text'],
  ['unknown.bin', null, 'generic'],
  ['unknown.bin', 42, 'generic'],
] as const)('classifies %s (%s) without overriding the authorised attachment behavior', (name, mime, expected) => {
  expect(attachmentIconKind(name, mime)).toBe(expected);
});
