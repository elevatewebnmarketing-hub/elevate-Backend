CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"cloudinary_public_id" text NOT NULL,
	"cloudinary_resource_type" text NOT NULL,
	"secure_url" text NOT NULL,
	"bytes" text,
	"width" text,
	"height" text,
	"duration_seconds" text,
	"format" text,
	"folder" text,
	"title" text,
	"purpose" text,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_cloudinary_public_id_uidx" ON "media_assets" USING btree ("cloudinary_public_id");--> statement-breakpoint
CREATE INDEX "media_assets_org_created_idx" ON "media_assets" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_uploaded_by_idx" ON "media_assets" USING btree ("uploaded_by_user_id");