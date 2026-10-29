/** Ételképek: csak valódi JPG/PNG/WebP (a fájl eleje alapján), legfeljebb ennyi bájt. */
export const IMAGE_MAX_BYTES = 600_000;
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export class ImageError extends Error{code:string;status:number;constructor(code:string,status=400){super(code);this.code=code;this.status=status;}}
export function detectImage(b:Uint8Array):ImageMime|null{
  if(b.length>3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return "image/jpeg";
  if(b.length>8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((v,i)=>b[i]===v))return "image/png";
  if(b.length>12&&String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP")return "image/webp";
  return null;
}
export function base64ToBytes(value:string){
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length%4!==0)throw new ImageError("IMAGE_FORMAT");
  const raw=atob(value);const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
}
/** A feltöltött base64 adat ellenőrzése: méret és valódi képformátum. */
export function validateImage(base64:string){
  if(base64.length>Math.ceil(IMAGE_MAX_BYTES/3)*4)throw new ImageError("IMAGE_TOO_LARGE",413);
  const bytes=base64ToBytes(base64);
  if(bytes.length>IMAGE_MAX_BYTES)throw new ImageError("IMAGE_TOO_LARGE",413);
  const mime=detectImage(bytes);
  if(!mime)throw new ImageError("IMAGE_FORMAT");
  return {mime,bytes};
}
export const imageUrl=(productId:string,revision:number)=>`/api/products/image?id=${encodeURIComponent(productId)}&v=${revision}`;
