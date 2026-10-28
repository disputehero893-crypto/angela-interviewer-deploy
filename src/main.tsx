import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import Review from "./Review";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const Root = path === "/review" ? Review : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
