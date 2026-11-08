import { config } from "dotenv";
config({ path: "../.env" });
import express from "express";
import wardrobeRouter from "./routes/wardrobeRouter";
import imageRouter from "./routes/imageRouter";
import uploadRouter from "./routes/uploadRouter";


const app = express();

app.use(express.json());

app.use("/api/wardrobe", wardrobeRouter);

app.use("/api/image", imageRouter);

// after the wardrobe mount:
app.use("/api/upload", uploadRouter);


app.listen(3000, () => {
  console.log("Server running on port 3000");
});