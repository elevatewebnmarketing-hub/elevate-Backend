process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/elevate_test";
process.env.JWT_SECRET ??= "test-secret-32-chars-minimum-len!!";
process.env.SITE_KEY_PEPPER ??= "test-pepper-16chars";
process.env.CORS_ORIGINS ??= "*";
process.env.SUPER_ADMIN_JWT_SECRET ??=
  "test-super-admin-jwt-32chars-minimum!!";
