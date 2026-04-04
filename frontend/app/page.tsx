import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  FolderKanban,
  Globe2,
  Languages,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { FloatLayer, HoverCard, Reveal } from "@/components/motion/primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const featureCards = [
  {
    icon: Workflow,
    title: "Structured translation flow",
    description:
      "Upload, validate, translate, review, and export without stitching together multiple tools.",
  },
  {
    icon: ShieldCheck,
    title: "Reviewer control",
    description:
      "Segment-level approvals, glossary checks, and cleaner validation cues keep quality visible.",
  },
  {
    icon: Globe2,
    title: "Built for teams",
    description:
      "Share document access, keep collaborators aligned, and bring people into the same workflow fast.",
  },
];

const steps = [
  "Upload a PDF or DOCX and preserve document structure.",
  "Run validation to surface source issues before translation.",
  "Generate translations, inspect TM suggestions, and edit inline.",
  "Approve final copy and export polished deliverables.",
];

export default async function HomePage() {
  const { userId } = await auth();

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(circle_at_top,rgba(21,196,255,0.18),transparent_45%),radial-gradient(circle_at_20%_20%,rgba(33,238,196,0.14),transparent_35%),linear-gradient(180deg,rgba(9,19,38,0.04),transparent_70%)] dark:bg-[radial-gradient(circle_at_top,rgba(21,196,255,0.18),transparent_45%),radial-gradient(circle_at_20%_20%,rgba(33,238,196,0.12),transparent_35%),linear-gradient(180deg,rgba(2,8,23,0.75),transparent_70%)]" />

      <section className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <Reveal className="flex items-center justify-between rounded-full border border-white/30 bg-white/55 px-4 py-3 shadow-[0_18px_50px_-40px_rgba(11,24,44,0.55)] backdrop-blur dark:border-white/10 dark:bg-slate-950/60 dark:shadow-[0_22px_70px_-45px_rgba(2,8,23,0.95)] md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#155dfc,#16c5ff)] text-white shadow-lg shadow-cyan-500/20">
              <Languages className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">SynTra AI</p>
              <p className="text-xs text-muted-foreground">
                AI workflow for premium multilingual delivery
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!userId ? (
              <>
                <Button asChild variant="ghost" className="rounded-full">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild className="rounded-full">
                  <Link href="/sign-up">Start with Google</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" className="rounded-full">
                  <Link href="/documents">Workspace</Link>
                </Button>
                <Button asChild className="rounded-full">
                  <Link href="/upload">Upload</Link>
                </Button>
              </>
            )}
          </div>
        </Reveal>

        <div className="grid items-center gap-12 pb-10 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <div className="space-y-8">
            <Reveal
              delay={0.08}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-200/70 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-sky-800 shadow-sm backdrop-blur dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-100"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Market-ready translation experience
            </Reveal>

            <Reveal delay={0.16} className="space-y-5">
              <h1 className="max-w-3xl text-5xl font-semibold leading-[1.03] tracking-tight text-foreground md:text-6xl lg:text-7xl">
                The translation workspace that finally feels as polished as the
                files you deliver.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
                SynTra AI helps teams move from raw source documents to
                export-ready multilingual assets through a calmer, more
                beautiful workflow for validation, translation, review, and
                collaboration.
              </p>
            </Reveal>

            <Reveal delay={0.24} className="flex flex-col gap-3 sm:flex-row">
              {!userId ? (
                <>
                  <Button
                    asChild
                    size="lg"
                    className="h-12 rounded-full px-6 text-sm"
                  >
                    <Link href="/sign-up">
                      Start with Google
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-12 rounded-full px-6 text-sm"
                  >
                    <Link href="/sign-in">Sign in to continue</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    asChild
                    size="lg"
                    className="h-12 rounded-full px-6 text-sm"
                  >
                    <Link href="/upload">
                      Upload a document
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-12 rounded-full px-6 text-sm"
                  >
                    <Link href="/documents">Browse documents</Link>
                  </Button>
                </>
              )}
            </Reveal>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { value: "5-step", label: "guided workflow" },
                { value: "TM-aware", label: "review surface" },
                { value: "Shareable", label: "document access" },
              ].map((item, index) => (
                <HoverCard
                  key={item.label}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.55, delay: 0.18 + index * 0.08 }}
                  className="rounded-[1.6rem] border border-white/35 bg-white/60 p-4 shadow-[0_24px_60px_-42px_rgba(11,24,44,0.55)] backdrop-blur dark:border-white/10 dark:bg-slate-950/55 dark:shadow-[0_24px_80px_-50px_rgba(2,8,23,0.9)]"
                >
                  <p className="text-2xl font-semibold tracking-tight text-foreground">
                    {item.value}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.label}
                  </p>
                </HoverCard>
              ))}
            </div>
          </div>

          <Reveal delay={0.2} className="relative">
            <FloatLayer className="absolute -left-8 top-10 hidden h-32 w-32 rounded-full bg-cyan-300/35 blur-3xl lg:block" />
            <FloatLayer
              className="absolute -right-8 bottom-8 hidden h-36 w-36 rounded-full bg-teal-300/25 blur-3xl lg:block"
              transition={{
                duration: 8,
                repeat: Infinity,
                repeatType: "mirror",
                ease: "easeInOut",
                delay: 0.6,
              }}
            />

            <HoverCard className="relative overflow-hidden rounded-[2rem] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,251,255,0.88))] p-4 shadow-[0_35px_120px_-50px_rgba(16,24,40,0.55)] backdrop-blur dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.9),rgba(7,12,24,0.96))] dark:shadow-[0_35px_120px_-50px_rgba(2,8,23,1)] xl:p-6">
              <div className="rounded-[1.5rem] border border-slate-200/70 bg-slate-950 px-5 py-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-300">
                      Live workspace preview
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      Review translations without losing context
                    </p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-200">
                    Synced with backend
                  </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Pipeline
                    </p>
                    {[
                      "Source validation complete",
                      "Translation draft generated",
                      "Glossary warnings highlighted",
                      "Export readiness tracked",
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/5 px-3 py-3"
                      >
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                        <span className="text-sm text-slate-100">{item}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 rounded-[1.4rem] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(17,24,39,0.84))] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">
                          Translation editor
                        </p>
                        <p className="mt-1 text-sm text-slate-300">
                          Approve final copy segment by segment.
                        </p>
                      </div>
                      <div className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                        87% complete
                      </div>
                    </div>

                    <div className="rounded-[1.2rem] border border-white/8 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        Source
                      </p>
                      <p className="mt-2 text-sm leading-7 text-slate-100">
                        The supplier shall provide updated implementation
                        timelines for all operational markets.
                      </p>
                    </div>

                    <div className="rounded-[1.2rem] border border-cyan-400/20 bg-cyan-400/8 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/75">
                          Draft translation
                        </p>
                        <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                          TM fuzzy
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-7 text-slate-50">
                        Le fournisseur doit fournir des calendriers de mise en
                        oeuvre actualises pour tous les marches operationnels.
                      </p>
                    </div>

                    <div className="rounded-[1.2rem] border border-emerald-300/18 bg-emerald-400/8 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-emerald-100/75">
                        Final output
                      </p>
                      <p className="mt-2 text-sm leading-7 text-slate-50">
                        Le fournisseur doit fournir des calendriers de mise en
                        oeuvre mis a jour pour l&apos;ensemble des marches
                        operationnels.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </HoverCard>
          </Reveal>
        </div>

        <section className="grid gap-4 py-6 md:grid-cols-3">
          {featureCards.map((feature, index) => (
            <HoverCard
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.55, delay: index * 0.08 }}
              className="rounded-[1.75rem] border border-white/30 bg-white/60 p-6 shadow-[0_24px_60px_-45px_rgba(11,24,44,0.5)] backdrop-blur dark:border-white/10 dark:bg-slate-950/55 dark:shadow-[0_28px_80px_-50px_rgba(2,8,23,0.95)]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(6,182,212,0.18),rgba(20,184,166,0.24))] text-cyan-700 dark:bg-[linear-gradient(135deg,rgba(34,211,238,0.18),rgba(45,212,191,0.22))] dark:text-cyan-200">
                <feature.icon className="h-5 w-5" />
              </div>
              <h2 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
                {feature.title}
              </h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                {feature.description}
              </p>
            </HoverCard>
          ))}
        </section>

        <section className="grid gap-6 py-10 lg:grid-cols-[0.9fr_1.1fr]">
          <HoverCard
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            className="rounded-[2rem] border border-white/30 bg-slate-950 p-7 text-white shadow-[0_35px_120px_-50px_rgba(2,8,23,0.8)]"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">
              Why teams switch
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              Onboarding that feels modern from the first click.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              The product experience should reassure users immediately:
              beautiful entry point, clear next actions, visible progress, and
              no confusion about what to do after a file is uploaded.
            </p>

            <div className="mt-8 space-y-4">
              {[
                "Public landing page and premium auth entry",
                "Protected product routes with redirect-safe sharing",
                "Responsive workspace for QA, translation, glossary, and export",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  <span className="text-sm text-slate-100">{item}</span>
                </div>
              ))}
            </div>
          </HoverCard>

          <div className="grid gap-4">
            <Reveal className="rounded-[2rem] border border-white/30 bg-white/60 p-6 backdrop-blur dark:border-white/10 dark:bg-slate-950/55">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Workflow
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {steps.map((step, index) => (
                  <div
                    key={step}
                    className="rounded-[1.5rem] border border-border/60 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                      Step {index + 1}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">
                      {step}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>

            <div className="grid gap-4 md:grid-cols-2">
              <HoverCard
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                className="rounded-[1.75rem] border border-white/30 bg-white/60 p-6 backdrop-blur dark:border-white/10 dark:bg-slate-950/55"
              >
                <FolderKanban className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
                  Shareable document access
                </h3>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Generate a link for a document, invite teammates in, and route
                  signed-out collaborators through auth before landing them in
                  the right file.
                </p>
              </HoverCard>
              <HoverCard
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.55, delay: 0.08 }}
                className="rounded-[1.75rem] border border-white/30 bg-white/60 p-6 backdrop-blur dark:border-white/10 dark:bg-slate-950/55"
              >
                <FileText className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
                  Fidelity-first exports
                </h3>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Keep the review experience grounded in the original document
                  structure, then export with confidence.
                </p>
              </HoverCard>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
