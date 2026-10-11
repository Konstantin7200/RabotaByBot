import { Router } from "express";
import { callback } from "./callback";

const router=Router();

router.get('/oauth/callback',callback)

export default router