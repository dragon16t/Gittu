import { useEffect, useState } from "react";
import { api } from "@/lib/api";

let name = localStorage.getItem("oe_brand") || "BLACKBA";
const subs = new Set();

export const setBrand = (n) => {
  name = n;
  localStorage.setItem("oe_brand", n);
  document.title = n;
  subs.forEach((f) => f(n));
};

api.get("/branding").then(({ data }) => setBrand(data.name)).catch(() => {});

export const useBrand = () => {
  const [n, setN] = useState(name);
  useEffect(() => { subs.add(setN); return () => subs.delete(setN); }, []);
  return n;
};

export const BrandName = () => useBrand();
