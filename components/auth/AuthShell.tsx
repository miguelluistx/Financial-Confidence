import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="relative min-h-screen bg-slate-950 font-sans text-white">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(59,130,246,0.35),transparent)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)]"
        aria-hidden="true"
      />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-3 self-start transition hover:opacity-90"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold shadow-lg shadow-blue-600/30">
            FC
          </div>
          <span className="text-sm font-semibold tracking-tight">
            Financial Confidence
          </span>
        </Link>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{subtitle}</p>
          <div className="mt-6">{children}</div>
          {footer ? <div className="mt-6 border-t border-white/10 pt-6">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}

export const authInputClassName =
  "block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-cyan-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-cyan-500/20";

export const authLabelClassName = "mb-2 block text-sm font-medium text-slate-300";

export const authPrimaryButtonClassName =
  "w-full rounded-xl border border-cyan-500/40 bg-cyan-600/20 py-3.5 text-sm font-semibold text-cyan-300 transition hover:border-cyan-500/60 hover:bg-cyan-600/30 disabled:cursor-not-allowed disabled:opacity-50";

export const authSecondaryLinkClassName =
  "text-sm font-medium text-cyan-300 transition hover:text-cyan-200";

export const authErrorClassName =
  "rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200";

export const authSuccessClassName =
  "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200";

export const authConfigWarningClassName =
  "rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200";
