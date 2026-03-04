export function Footer() {
    return (
        <footer className="bg-slate-950 border-t border-indigo-500/20 py-12 relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    {/* Brand */}
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_10px_rgba(124,58,237,0.4)]">
                            <span className="text-white font-bold tracking-tighter">MC</span>
                        </div>
                        <span className="text-lg font-bold text-white tracking-wide">魔片漫创</span>
                    </div>

                    {/* Copyright */}
                    <p className="text-slate-500 text-sm font-medium">
                        © 2026 魔片漫创 Mopian Creator. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}
