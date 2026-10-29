"use client";
import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { imageUrl, IMAGE_MAX_BYTES } from "@/src/modules/images/domain";

const MAX_SIDE = 1200;

/** A kiválasztott képet a böngészőben legfeljebb 1200 px-re kicsinyíti, WebP-be (vagy JPG-be) menti, base64-ként adja vissza. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    const usable = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (usable && usable.size <= IMAGE_MAX_BYTES) {
      const bytes = new Uint8Array(await usable.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }
  }
  throw new Error("IMAGE_TOO_LARGE");
}

type ImageProduct = { id: string; hasImage?: number; imageRevision?: number };

/** Az étel képe, vagy ha nincs, semmi (a hívó a helyére saját díszítést tesz). */
export function ProductImage({ product, alt, className }: { product: ImageProduct; alt: string; className?: string }) {
  if (product.hasImage !== 1) return null;
  return <img className={className ?? "product-photo"} src={imageUrl(product.id, product.imageRevision ?? 0)} alt={alt} loading="lazy" decoding="async" />;
}

/** Kép feltöltése, cseréje és törlése a katalógusban. */
export function ProductImageControls({
  product,
  t,
  busy,
  mutate,
  onError,
}: {
  product: ImageProduct;
  t: (key: string) => string;
  busy: boolean;
  mutate: (path: string, body: unknown) => Promise<boolean>;
  onError: (code: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const has = product.hasImage === 1;
  async function choose(file: File | undefined) {
    if (!file) return;
    setWorking(true);
    try {
      const data = await shrink(file);
      await mutate("products/image", { productId: product.id, revision: product.imageRevision ?? 0, data });
    } catch (e) {
      onError(e instanceof Error && e.message === "IMAGE_TOO_LARGE" ? "IMAGE_TOO_LARGE" : "IMAGE_FORMAT");
    } finally {
      setWorking(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="product-image-actions">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void choose(e.target.files?.[0])} />
      <button type="button" className="button secondary" disabled={busy || working} onClick={() => input.current?.click()}>
        <ImagePlus size={15} />
        {t(working ? "imageWorking" : has ? "imageReplace" : "imageUpload")}
      </button>
      {has && (
        <button
          type="button"
          className="icon-button"
          aria-label={t("imageRemove")}
          title={t("imageRemove")}
          disabled={busy || working}
          onClick={() => {
            if (window.confirm(t("imageRemoveConfirm"))) void mutate("products/image/remove", { productId: product.id, revision: product.imageRevision ?? 0 });
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
