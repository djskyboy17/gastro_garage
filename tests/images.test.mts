import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node native type stripping
import {detectImage,validateImage,IMAGE_MAX_BYTES,imageUrl} from '../src/modules/images/domain.ts';
// @ts-ignore Node native type stripping
import {canWrite} from '../src/modules/access/domain.ts';
const b64=(bytes:number[])=>Buffer.from(bytes).toString('base64');
test('Only real JPG, PNG and WebP files are accepted, judged by content',()=>{
 assert.equal(detectImage(new Uint8Array([0xff,0xd8,0xff,0xe0,0])),'image/jpeg');
 assert.equal(detectImage(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0])),'image/png');
 assert.equal(detectImage(new Uint8Array([...Buffer.from('RIFF'),0,0,0,0,...Buffer.from('WEBP'),0])),'image/webp');
 assert.equal(validateImage(b64([0xff,0xd8,0xff,0xe0,1,2,3,4])).mime,'image/jpeg');
 // SVG/HTML disguised as an image is rejected.
 assert.throws(()=>validateImage(Buffer.from('<svg onload="x()"></svg>').toString('base64')),/IMAGE_FORMAT/);
 assert.throws(()=>validateImage('not base64!'),/IMAGE_FORMAT/);
});
test('Oversized images are rejected',()=>{
 const big=new Uint8Array(IMAGE_MAX_BYTES+1);big.set([0xff,0xd8,0xff]);
 assert.throws(()=>validateImage(Buffer.from(big).toString('base64')),/IMAGE_TOO_LARGE/);
});
test('Image URLs carry the revision so a new image is never served from cache',()=>{
 assert.equal(imageUrl('p 1',3),'/api/products/image?id=p%201&v=3');
 assert.notEqual(imageUrl('p1',3),imageUrl('p1',4));
});
test('Only administrators and dispatchers can change dish images',()=>{
 for(const path of ['/api/products/image','/api/products/image/remove']){
  assert.equal(canWrite('owner',path,{}),true);
  assert.equal(canWrite('admin',path,{}),true);
  assert.equal(canWrite('dispatcher',path,{}),true);
  for(const role of ['kitchen','warehouse','courier','pending','disabled'] as const)assert.equal(canWrite(role,path,{}),false);
 }
});
