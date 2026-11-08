import { config } from "dotenv";
config({ path: "../.env" });
import express from "express";
import { auth } from "express-oauth2-jwt-bearer";
import { imageRouter } from "./routes/imageRouter";

const auth0Domain = process.env.VITE_AUTH0_DOMAIN;
const auth0Audience = process.env.VITE_AUTH0_AUDIENCE;
if (!auth0Domain || !auth0Audience) {
  throw new Error("VITE_AUTH0_DOMAIN and VITE_AUTH0_AUDIENCE are required by the API");
}

const auth0IssuerBaseURL = `${
  auth0Domain.startsWith("http") ? auth0Domain : `https://${auth0Domain}`
}`.replace(/\/+$/, "") + "/";

const app = express();

app.use(express.json());

app.use(
  "/api",
  auth({ issuerBaseURL: auth0IssuerBaseURL, audience: auth0Audience }),
  imageRouter
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode =
    error && typeof error === "object" && "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;

  if (statusCode >= 500) console.error("API authentication failed:", error);

  res.status(statusCode).json({
    error: statusCode === 401
      ? "Authentication is required. Please sign in and try again."
      : statusCode === 403
        ? "You are not allowed to access this resource."
        : "The API could not process the request.",
  });
});


app.listen(3000, () => {
  console.log("Server running on port 3000");
});