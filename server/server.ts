import express from "express";
import wardrobeRouter from "./routes/wardrobeRouter";

const app = express();

app.use(express.json());

app.use("/api/wardrobe", wardrobeRouter);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});