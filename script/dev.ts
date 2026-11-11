process.env.NODE_ENV = "development";
process.env.APERTURE_DEMO = "1";

await import("../server/index");
