import type { Email } from 'postal-mime';
import type { InboundAttachmentContent } from './inbound-attachments';
import { ReplyParser } from './reply-parser';

const encoder=new TextEncoder();
const bytes=(value:string)=>encoder.encode(value).byteLength;
const messageId=/^<[^\s<>@\u0000-\u001f\u007f-\uffff]+@[^\s<>@\u0000-\u001f\u007f-\uffff]+>$/;

/** Pure post-parse validation. The caller must admit and bound the raw reader
 * and MIME parser first; these checks cannot retroactively bound parsing work. */
export function normalizeInboundParsed(email:Email,identity:{from:string;messageId:string}):{
  subject:string;body:string;references:string[];attachments:InboundAttachmentContent[];
} {
  if(!email.from?.address || email.from.group || email.from.address.trim().toLowerCase()!==identity.from
    || email.messageId!==identity.messageId)throw new Error('Inbound parsed identity mismatch');
  const subject=email.subject??'No Subject';
  if(bytes(subject)>2048 || /[\r\n\u0000]/.test(subject))throw new Error('Invalid inbound subject');
  if(bytes(email.text??'')>2_097_152 || bytes(email.html??'')>2_097_152)throw new Error('Inbound body part too large');
  const body=ReplyParser.stripHistory(email.text,email.html);
  if(bytes(body)>262_144)throw new Error('Inbound body too large');
  if((email.inReplyTo?.length??0)+(email.references?.length??0)>8192)throw new Error('Inbound references too large');
  const tokens=[...(email.inReplyTo?[email.inReplyTo]:[]),...(email.references??'').split(/\s+/).filter(Boolean).reverse()];
  if(tokens.length>20 || tokens.some(value=>value.length>256 || !messageId.test(value)))throw new Error('Invalid inbound references');
  if(email.attachments.length>10)throw new Error('Too many inbound attachments');
  let total=0;
  const attachments=email.attachments.map(item=>{
    const filename=item.filename||'unnamed',contentType=item.mimeType;
    if(bytes(filename)>255 || /[\u0000-\u001f\u007f]/.test(filename)
      || !contentType || contentType.length>255 || /[^\u0020-\u007e]/.test(contentType))throw new Error('Invalid inbound attachment metadata');
    if(!(item.content instanceof ArrayBuffer) && !(item.content instanceof Uint8Array))throw new Error('Unsupported inbound attachment encoding');
    const content=item.content instanceof Uint8Array?item.content.slice():new Uint8Array(item.content.slice(0));
    if(content.byteLength<1 || (total+=content.byteLength)>2_097_152)throw new Error('Invalid inbound attachment size');
    return {filename,contentType,content};
  });
  return {subject,body,references:[...new Set(tokens)],attachments};
}
