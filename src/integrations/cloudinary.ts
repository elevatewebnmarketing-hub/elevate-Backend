import { v2 as cloudinary } from "cloudinary";
import type { CloudinaryCredentials } from "../config/env.js";

export type ResourceTypeForUpload = "image" | "video";

export function configureCloudinary(creds: CloudinaryCredentials): void {
  cloudinary.config({
    cloud_name: creds.cloudName,
    api_key: creds.apiKey,
    api_secret: creds.apiSecret,
    secure: true,
  });
}

/**
 * Parameters for a browser/mobile direct upload to Cloudinary.
 * The client POSTs multipart form data to `uploadUrl` with these fields plus the file.
 * Never send `apiSecret` to the client — only `signature` + `timestamp` + `apiKey` + `cloudName`.
 */
export function createSignedUploadParams(
  creds: CloudinaryCredentials,
  options: {
    organizationId: string;
    uploaderTag: string;
    extraTags?: string[] | undefined;
    /** Optional subfolder under org (sanitized). */
    context?: string | undefined;
    resourceType: ResourceTypeForUpload;
  },
): {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  tags: string;
  resourceType: ResourceTypeForUpload;
  uploadUrl: string;
} {
  const timestamp = Math.round(Date.now() / 1000);
  const safeContext =
    options.context?.replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 120) ?? "";
  const folder = safeContext
    ? `elevate/orgs/${options.organizationId}/${safeContext}`
    : `elevate/orgs/${options.organizationId}`;
  const tags = [options.uploaderTag, ...(options.extraTags ?? [])]
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[^a-zA-Z0-9_-]/g, "_"))
    .slice(0, 12)
    .join(",");

  const paramsToSign: Record<string, string | number> = {
    timestamp,
    folder,
    tags,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    creds.apiSecret,
  );

  const pathSegment = options.resourceType === "video" ? "video" : "image";
  const uploadUrl = `https://api.cloudinary.com/v1_1/${creds.cloudName}/${pathSegment}/upload`;

  return {
    cloudName: creds.cloudName,
    apiKey: creds.apiKey,
    timestamp,
    signature,
    folder,
    tags,
    resourceType: options.resourceType,
    uploadUrl,
  };
}
