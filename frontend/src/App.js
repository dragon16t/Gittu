import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import "@/App.css";
import { SessionProvider, useSession } from "@/lib/session";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Forgot from "@/pages/auth/Forgot";
import Game from "@/pages/Game";
import Practice from "@/pages/Practice";
import Wallet from "@/pages/Wallet";
import Deposit from "@/pages/Deposit";
import Withdraw from "@/pages/Withdraw";
import Settings from "@/pages/Settings";
import Messages from "@/pages/Messages";
import Refer from "@/pages/Refer";
import History from "@/pages/History";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminPanel from "@/pages/admin/AdminPanel";
import VerifierLogin from "@/pages/verifier/VerifierLogin";
import VerifierDashboard from "@/pages/verifier/VerifierDashboard";

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm" data-testid="loading">Loading…</div>
);

function Guard({ login }) {
  const { user } = useSession();
  if (user === null) return <Loading />;
  if (!user) return <Navigate to={login} replace />;
  return <Outlet />;
}

const Portal = ({ portal }) => (
  <SessionProvider portal={portal}>
    <Outlet />
  </SessionProvider>
);

export default function App() {
  return (
    <div className="grain min-h-screen">
      <BrowserRouter>
        <Routes>
          <Route element={<Portal portal="user" />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot" element={<Forgot />} />
            <Route element={<Guard login="/login" />}>
              <Route path="/" element={<Game />} />
              <Route path="/practice" element={<Practice />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/deposit" element={<Deposit />} />
              <Route path="/withdraw" element={<Withdraw />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/refer" element={<Refer />} />
              <Route path="/history" element={<History />} />
            </Route>
          </Route>
          <Route element={<Portal portal="admin" />}>
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route element={<Guard login="/admin/login" />}>
              <Route path="/admin" element={<AdminPanel />} />
            </Route>
          </Route>
          <Route element={<Portal portal="verifier" />}>
            <Route path="/verifier/login" element={<VerifierLogin />} />
            <Route element={<Guard login="/verifier/login" />}>
              <Route path="/verifier" element={<VerifierDashboard />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" position="top-center" richColors />
    </div>
  );
}
