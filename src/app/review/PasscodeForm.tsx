"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "./actions";

export default function PasscodeForm() {
    const router = useRouter();
    const [state, action, pending] = useActionState(login, null);

    useEffect(() => {
        if (state?.ok) router.refresh();
    }, [state, router]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-4">
            <form
                action={action}
                className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-5"
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                        <Lock className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold">Script Review</h1>
                        <p className="text-sm text-slate-400">Enter the reviewer passcode</p>
                    </div>
                </div>
                <Input
                    name="passcode"
                    type="password"
                    autoFocus
                    required
                    placeholder="Passcode"
                    className="bg-slate-950 border-slate-800 h-11"
                />
                {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
                <Button type="submit" disabled={pending || state?.ok} className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white">
                    {pending || state?.ok ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                </Button>
            </form>
        </div>
    );
}
