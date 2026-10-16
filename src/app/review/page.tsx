import type { Metadata } from "next";
import { isAuthed, loadReviewData } from "@/lib/review/server";
import PasscodeForm from "./PasscodeForm";
import ReviewApp from "./ReviewApp";

export const metadata: Metadata = {
    title: "Script Review",
    description: "Review and approve generated founder-message audio",
};

export const dynamic = "force-dynamic";

export default async function ReviewPage({
    searchParams,
}: {
    searchParams: Promise<{ set?: string; script?: string }>;
}) {
    if (!(await isAuthed())) return <PasscodeForm />;

    const [{ sets, scripts, library }, params] = await Promise.all([loadReviewData(), searchParams]);
    return (
        <ReviewApp
            sets={sets}
            scripts={scripts}
            library={library}
            initialSetId={params.set}
            initialScriptId={params.script}
        />
    );
}
