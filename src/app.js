import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import taskRoutes from "./routes/task.routes.js";
import authRoutes from "./routes/authRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import calendarRoutes from "./routes/calendarRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/error.middleware.js";

const app = express();
app.set("trust proxy", 1);
const frontendOrigins = [
  ...(process.env.FRONTEND_URL || "").split(","),
  process.env.TASK_APP_URL,
  "https://todo-react-frontend-psi.vercel.app",
  "http://localhost:5173",
  ,
]
  .map((origin) => {
    if (!origin || origin.trim() === "*") return null;
    try {
      return new URL(origin.trim()).origin;
    } catch {
      return null;
    }
  })
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      let requestedOrigin;
      try {
        requestedOrigin = new URL(origin).origin;
      } catch {
        return callback(null, false);
      }
      return callback(null, frontendOrigins.includes(requestedOrigin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Workspace-Id",
      "X-Request-Id",
    ],
    exposedHeaders: ["X-Cache"],
  }),
);
app.use(express.json());
app.use(cookieParser());

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
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/audit-logs", auditRoutes);
// app.use("/api/tasks", taskRoutes);
app.use("/api/tasks", taskRoutes);

// Error Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
