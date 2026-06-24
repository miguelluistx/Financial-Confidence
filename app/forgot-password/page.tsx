"use client";

import Link from "next/link";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
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

    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${window.location.origin}/reset-password`,
      },
    );

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSuccess("Password reset email sent. Check your inbox for the reset link.");
  };

  return (
    <AuthShell
      title="Forgot Password"
      subtitle="Enter your email and we will send you a reset link."
      footer={
        <p className="text-center text-sm text-slate-400">
          Remember your password?{" "}
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
          <label htmlFor="forgot-email" className={authLabelClassName}>
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={authInputClassName}
            placeholder="you@email.com"
          />
        </div>

        {error ? <p className={authErrorClassName}>{error}</p> : null}
        {success ? <p className={authSuccessClassName}>{success}</p> : null}

        <button
          type="submit"
          disabled={loading || !isSupabaseConfigured()}
          className={authPrimaryButtonClassName}
        >
          {loading ? "Sending..." : "Send Reset Email"}
        </button>
      </form>
    </AuthShell>
  );
}
