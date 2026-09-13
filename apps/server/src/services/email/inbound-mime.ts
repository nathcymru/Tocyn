import PostalMime from 'postal-mime';
import { MAX_INBOUND_RAW_BYTES } from './inbound-raw';
import { normalizeInboundParsed } from './inbound-parsed';

/** Parse only the owned buffer returned by the already-admitted raw reader.
 * Line and nesting ceilings constrain pathological MIME structure as well as
 * bytes. This helper performs no IO or mutation and cannot grant admission. */
export async function parseInboundMime(raw:Uint8Array,identity:{from:string;messageId:string}) {
  if(raw.byteLength<1 || raw.byteLength>MAX_INBOUND_RAW_BYTES)throw new Error('Invalid inbound MIME size');
  let lines=1,lineBytes=0;
  for(const byte of raw){
    if(byte===10){if(++lines>8192)throw new Error('Too many inbound MIME lines');lineBytes=0;}
    else if(++lineBytes>65_536)throw new Error('Inbound MIME line too large');
  }
  const email=await new PostalMime({attachmentEncoding:'arraybuffer',maxNestingDepth:16,maxHeadersSize:65_536}).parse(raw);
  return normalizeInboundParsed(email,identity);
}
