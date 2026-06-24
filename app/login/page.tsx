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
} from "@/components/auth/AuthShell";
import {
  createClient,
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
} from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

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

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push("/");
    router.refresh();
  };

  return (
    <AuthShell
      title="Log In"
      subtitle="Sign in to your Financial Confidence account."
      footer={
        <p className="text-center text-sm text-slate-400">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className={authSecondaryLinkClassName}>
            Sign Up
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
          <label htmlFor="login-email" className={authLabelClassName}>
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={authInputClassName}
            placeholder="you@email.com"
          />
        </div>

        <div>
          <label htmlFor="login-password" className={authLabelClassName}>
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={authInputClassName}
            placeholder="Your password"
          />
        </div>

        <div className="text-right">
          <Link href="/forgot-password" className={authSecondaryLinkClassName}>
            Forgot password?
          </Link>
        </div>

        {error ? <p className={authErrorClassName}>{error}</p> : null}

        <button
          type="submit"
          disabled={loading || !isSupabaseConfigured()}
          className={authPrimaryButtonClassName}
        >
          {loading ? "Signing in..." : "Log In"}
        </button>
      </form>
    </AuthShell>
  );
}
