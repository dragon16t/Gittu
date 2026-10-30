import { useState } from "react";
import { toast } from "sonner";
import { Upload, Check } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { Field, SilverButton } from "@/components/common";

const PhotoPick = ({ label, file, onPick, testid }) => (
  <label className={`flex items-center gap-3 rounded-xl border border-dashed px-3.5 h-12 cursor-pointer text-sm transition-colors ${file ? "border-emerald-400/60 text-emerald-300" : "border-white/20 text-neutral-400 hover:border-white/40"}`}>
    {file ? <Check size={16} /> : <Upload size={16} />}
    <span className="truncate">{file ? file.name : label}</span>
    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid={testid}
      onChange={(e) => onPick(e.target.files?.[0] || null)} />
  </label>
);

export const KycForm = ({ onDone }) => {
  const [f, setF] = useState({ aadhaar_name: "", aadhaar_number: "", pan_name: "", pan_number: "" });
  const [files, setFiles] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (k) => (file) => setFiles({ ...files, [k]: file });
  const submit = async () => {
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    Object.entries(files).forEach(([k, v]) => v && fd.append(k, v));
    setBusy(true);
    try {
      await api.post("/kyc", fd);
      toast.success("KYC submitted. Our team will verify it shortly.");
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const ready = f.aadhaar_name && f.aadhaar_number && files.aadhaar_front && files.aadhaar_back;
  return (
    <div className="panel p-5 space-y-3.5 rise" data-testid="kyc-form">
      <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Aadhaar card · required</div>
      <Field label="Full name as on Aadhaar" value={f.aadhaar_name} onChange={set("aadhaar_name")} testid="kyc-aadhaar-name-input" />
      <Field label="Aadhaar number (12 digits)" inputMode="numeric" maxLength={14} value={f.aadhaar_number} onChange={set("aadhaar_number")} testid="kyc-aadhaar-number-input" />
      <PhotoPick label="Upload Aadhaar front photo" file={files.aadhaar_front} onPick={pick("aadhaar_front")} testid="kyc-aadhaar-front-input" />
      <PhotoPick label="Upload Aadhaar back photo" file={files.aadhaar_back} onPick={pick("aadhaar_back")} testid="kyc-aadhaar-back-input" />
      <div className="text-xs uppercase tracking-[0.2em] text-neutral-500 pt-2">PAN card · optional</div>
      <Field label="Name as on PAN" value={f.pan_name} onChange={set("pan_name")} testid="kyc-pan-name-input" />
      <Field label="PAN number" maxLength={10} value={f.pan_number} onChange={(e) => setF({ ...f, pan_number: e.target.value.toUpperCase() })} testid="kyc-pan-number-input" />
      <PhotoPick label="Upload PAN card photo" file={files.pan} onPick={pick("pan")} testid="kyc-pan-photo-input" />
      <p className="text-[11px] text-neutral-500">Your documents are encrypted and stored securely. One Aadhaar can be linked to only one account.</p>
      <SilverButton onClick={submit} disabled={busy || !ready} data-testid="kyc-submit-button">{busy ? "UPLOADING…" : "SUBMIT FOR VERIFICATION"}</SilverButton>
    </div>
  );
};
