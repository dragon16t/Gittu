import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API, withCredentials: true });

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (d == null) return e?.message || "Something went wrong. Please try again.";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" ");
  return d.msg || String(d);
};

export const inr = (p) =>
  `₹${((p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const inr0 = (p) => `₹${((p || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const toPaise = (r) => Math.round(parseFloat(r || 0) * 100);
export const dt = (s) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const blobUrl = async (path) => {
  const r = await api.get(path, { responseType: "blob" });
  return URL.createObjectURL(r.data);
};
