CREATE TYPE "WechatLoginSessionPurpose" AS ENUM ('login', 'bind');
CREATE TYPE "WechatLoginSessionStatus" AS ENUM ('pending', 'binding_required', 'confirmed', 'consumed', 'expired');

CREATE TABLE "user_wechat_bindings" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "app_id" VARCHAR(64) NOT NULL,
  "open_id" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_wechat_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wechat_login_sessions" (
  "id" UUID NOT NULL,
  "scene" VARCHAR(32) NOT NULL,
  "purpose" "WechatLoginSessionPurpose" NOT NULL,
  "status" "WechatLoginSessionStatus" NOT NULL DEFAULT 'pending',
  "target_user_id" UUID,
  "user_id" UUID,
  "open_id" VARCHAR(128),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wechat_login_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_wechat_bindings_user_id_key" ON "user_wechat_bindings"("user_id");
CREATE UNIQUE INDEX "user_wechat_bindings_app_id_open_id_key" ON "user_wechat_bindings"("app_id", "open_id");
CREATE INDEX "user_wechat_bindings_open_id_idx" ON "user_wechat_bindings"("open_id");
CREATE UNIQUE INDEX "wechat_login_sessions_scene_key" ON "wechat_login_sessions"("scene");
CREATE INDEX "wechat_login_sessions_status_expires_at_idx" ON "wechat_login_sessions"("status", "expires_at");
CREATE INDEX "wechat_login_sessions_target_user_id_idx" ON "wechat_login_sessions"("target_user_id");
CREATE INDEX "wechat_login_sessions_user_id_idx" ON "wechat_login_sessions"("user_id");

ALTER TABLE "user_wechat_bindings"
  ADD CONSTRAINT "user_wechat_bindings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wechat_login_sessions"
  ADD CONSTRAINT "wechat_login_sessions_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wechat_login_sessions"
  ADD CONSTRAINT "wechat_login_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;