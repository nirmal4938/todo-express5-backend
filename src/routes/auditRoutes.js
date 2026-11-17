import { Router } from "express";
import {
  exportAuditLogsCsv,
  getAuditLogs,
} from "../controllers/auditController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorizeWorkspace } from "../middlewares/authorizeWorkspace.js";

const router = Router();

router.use(authenticate, authorizeWorkspace(["OWNER", "ADMIN"]));
router.get("/export.csv", exportAuditLogsCsv);
router.get("/", getAuditLogs);

export default router;
