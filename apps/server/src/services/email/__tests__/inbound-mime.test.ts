import {describe,expect,it} from 'vitest';
import {parseInboundMime} from '../inbound-mime';
const encoder=new TextEncoder();
const identity={from:'sender@example.invalid',messageId:'<one@example.invalid>'};
const headers='From: Sender <sender@example.invalid>\r\nTo: support@example.invalid\r\nMessage-ID: <one@example.invalid>\r\nSubject: Synthetic\r\n';
describe('bounded actual PostalMime integration',()=>{
  it('parses a synthetic multipart message and binary attachment',async()=>{
    const raw=headers+'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="synthetic"\r\n\r\n'
      +'--synthetic\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNewest reply\r\n> Prior history\r\n'
      +'--synthetic\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="fixture.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAQID\r\n--synthetic--\r\n';
    const parsed=await parseInboundMime(encoder.encode(raw),identity);
    expect(parsed.subject).toBe('Synthetic');expect(parsed.body).toBe('Newest reply');
    expect(parsed.attachments).toEqual([{filename:'fixture.bin',contentType:'application/octet-stream',content:new Uint8Array([1,2,3])}]);
  });
  it('rejects oversized raw, lines and line count before parser allocation',async()=>{
    await expect(parseInboundMime(new Uint8Array(),identity)).rejects.toThrow('size');
    await expect(parseInboundMime(new Uint8Array(2_097_153),identity)).rejects.toThrow('size');
    await expect(parseInboundMime(encoder.encode(headers+'\r\n'+'a'.repeat(65_537)),identity)).rejects.toThrow('line too large');
    await expect(parseInboundMime(encoder.encode(headers+'\r\n'+'a\n'.repeat(8192)),identity)).rejects.toThrow('Too many');
  });
  it('enforces parser header and nesting ceilings',async()=>{
    await expect(parseInboundMime(encoder.encode(headers+'X-A: '+'a'.repeat(40_000)+'\r\nX-B: '+'b'.repeat(40_000)+'\r\n\r\nbody'),identity)).rejects.toThrow('header size');
    let nested='Content-Type: text/plain\r\n\r\nbody';
    for(let i=0;i<20;i++)nested=`Content-Type: multipart/mixed; boundary="part-${i}"\r\n\r\n--part-${i}\r\n${nested}\r\n--part-${i}--\r\n`;
    await expect(parseInboundMime(encoder.encode(headers+nested),identity)).rejects.toThrow('nesting depth');
  });
  it('rejects parsed sender and message-id conflicts',async()=>{
    const raw=encoder.encode(headers+'\r\nSynthetic body');
    await expect(parseInboundMime(raw,{...identity,from:'other@example.invalid'})).rejects.toThrow('identity mismatch');
    await expect(parseInboundMime(raw,{...identity,messageId:'<other@example.invalid>'})).rejects.toThrow('identity mismatch');
  });
});
