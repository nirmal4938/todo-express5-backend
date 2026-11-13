import express from "express";
import cors from "cors";
import taskRoutes from "./routes/task.routes.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/error.middleware.js";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  }),
);
app.use(express.json());

// Add this right above app.get('/health', ...) in src/app.js
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "To-Do List Express 5 API is running",
    health: "/health",
    tasks: "/api/v1/tasks",
  });
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// API Routes
app.use("/api/v1/tasks", taskRoutes);

// Error Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
