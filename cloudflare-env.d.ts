declare namespace Cloudflare {
  interface Env {
    KITCHEN_OWNER_EMAIL?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
