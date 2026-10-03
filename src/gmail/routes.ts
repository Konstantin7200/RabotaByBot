import { Router } from "express";
import { notificationHandler } from "./notificationHandler";

export const gmailRouter=Router();

gmailRouter.post('/gmail/notification',notificationHandler)
