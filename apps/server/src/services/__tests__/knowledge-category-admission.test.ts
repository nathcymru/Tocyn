import {describe,expect,it} from 'vitest';
import {knowledgeCategoryEnvelope} from '../knowledge-category-admission.service';

describe('knowledge category admission envelope',()=>{
  it('prices every retained category and projected byte without a fixed list cap',()=>{
    const envelope=knowledgeCategoryEnvelope({population:{exists:true,categoryRows:25_000,projectionBytes:6_400_000,revision:7}},'knowledge.category.list');
    expect(envelope).toMatchObject({workerRequests:1,d1RowsRead:79_096,d1RowsWritten:16});
  });

  it('prices complete document and category reference scans for delete',()=>{
    const envelope=knowledgeCategoryEnvelope({population:{exists:true,categoryRows:2_000,projectionBytes:256_000,revision:3},
      target:{exists:true,name:'Retained',parentId:null,createdAt:'2026-09-11T00:00:00.000Z'},documentRows:30_000,documentRevision:4},
      'knowledge.category.delete',128);
    expect(envelope).toMatchObject({d1RowsRead:101_097,d1RowsWritten:128});
  });

  it('fails closed for unsafe population accounting',()=>{
    expect(knowledgeCategoryEnvelope({population:{exists:true,categoryRows:Number.MAX_SAFE_INTEGER,projectionBytes:0,revision:1}},
      'knowledge.category.list')).toBeNull();
  });
});
