(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://aipos:aipos@localhost:5432/aipos_test";
process.env.FIELD_ENCRYPTION_KEY ??= "test-field-key";
process.env.EMAIL_PROVIDER = "mock";
process.env.APP_URL ??= "http://localhost:3000";
