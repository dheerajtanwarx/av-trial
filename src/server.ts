import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import passport from "passport";
import { configurePassport } from "./config/passport";
import authRouter from "./routes/auth";
import productsRouter from "./routes/products";
import categoriesRouter from "./routes/categories";
import promosRouter from "./routes/promos";
import newsletterRouter from "./routes/newsletter";
import ordersRouter from "./routes/orders";
import cartRouter from "./routes/cart";
import wishlistRouter from "./routes/wishlist";
import addressesRouter from "./routes/addresses";
import reviewsRouter from "./routes/reviews";
import adminRouter from "./routes/admin";
import adminProductsRouter from "./routes/adminProducts";
import settingsRouter from "./routes/settings";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

configurePassport();
app.use(passport.initialize());

app.use("/api/auth", authRouter);

app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/promos", promosRouter);
app.use("/api/newsletter", newsletterRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/cart", cartRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/addresses", addressesRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/admin/products", adminProductsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/settings", settingsRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});

export default app;
