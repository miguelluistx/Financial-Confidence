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

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setError("Name is required.");
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

    const storedLanguage =
      typeof window !== "undefined"
        ? (() => {
            try {
              const raw = localStorage.getItem("financial-confidence-language");
              return raw === "es" ? "es" : "en";
            } catch {
              return "en";
            }
          })()
        : "en";

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: {
          full_name: trimmedName,
          language_preference: storedLanguage,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      router.push("/");
      router.refresh();
      return;
    }

    setSuccess(
      "Account created. Check your email to confirm your account, then log in.",
    );
  };

  return (
    <AuthShell
      title="Sign Up"
      subtitle="Create your Financial Confidence account."
      footer={
        <p className="text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className={authSecondaryLinkClassName}>
            Log In
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
          <label htmlFor="signup-name" className={authLabelClassName}>
            Name
          </label>
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={authInputClassName}
            placeholder="Your name"
          />
        </div>

        <div>
          <label htmlFor="signup-email" className={authLabelClassName}>
            Email
          </label>
          <input
            id="signup-email"
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
          <label htmlFor="signup-password" className={authLabelClassName}>
            Password
          </label>
          <input
            id="signup-password"
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
          <label htmlFor="signup-confirm-password" className={authLabelClassName}>
            Confirm Password
          </label>
          <input
            id="signup-confirm-password"
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
          {loading ? "Creating account..." : "Sign Up"}
        </button>
      </form>
    </AuthShell>
  );
}
