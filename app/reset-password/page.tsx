"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AuthShell,
  authConfigWarningClassName,
  authErrorClassName,
  authInputClassName,
  authLabelClassName,
  authPrimaryButtonClassName,
  authSecondaryLinkClassName,
  authSuccessClassName,
} from "@/components/auth/AuthShell";
import {
  createClient,
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
} from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isSupabaseConfigured()) {
      setError(SUPABASE_SETUP_MESSAGE);
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError(SUPABASE_SETUP_MESSAGE);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Password updated successfully. Redirecting to log in...");
    setTimeout(() => {
      router.push("/login");
      router.refresh();
    }, 1500);
  };

  return (
    <AuthShell
      title="Reset Password"
      subtitle="Choose a new password for your account."
      footer={
        <p className="text-center text-sm text-slate-400">
          <Link href="/login" className={authSecondaryLinkClassName}>
            Back to Log In
          </Link>
        </p>
      }
    >
      {!isSupabaseConfigured() ? (
        <p className={authConfigWarningClassName}>
          Set <code className="text-amber-100">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-amber-100">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your
          environment to enable authentication.
        </p>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="reset-password" className={authLabelClassName}>
            New Password
          </label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={authInputClassName}
            placeholder="At least 6 characters"
          />
        </div>

        <div>
          <label htmlFor="reset-confirm-password" className={authLabelClassName}>
            Confirm Password
          </label>
          <input
            id="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={authInputClassName}
            placeholder="Re-enter your password"
          />
        </div>

        {error ? <p className={authErrorClassName}>{error}</p> : null}
        {success ? <p className={authSuccessClassName}>{success}</p> : null}

        <button
          type="submit"
          disabled={loading || !isSupabaseConfigured()}
          className={authPrimaryButtonClassName}
        >
          {loading ? "Updating..." : "Update Password"}
        </button>
      </form>
    </AuthShell>
  );
}
