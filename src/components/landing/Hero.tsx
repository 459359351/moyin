import { Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export function Hero() {
    const navigate = useNavigate();

    return (
        <section id="home" className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0A061E]">
            {/* Radial gradient overlay */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15),transparent_60%)]"></div>

            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div
                    className="absolute w-[500px] h-[500px] bg-violet-600/20 rounded-full blur-[100px] animate-[floatOrb1_20s_ease-in-out_infinite]"
                    style={{ top: '0%', left: '10%' }}
                />
                <div
                    className="absolute w-[400px] h-[400px] bg-cyan-500/20 rounded-full blur-[100px] animate-[floatOrb2_15s_ease-in-out_infinite]"
                    style={{ bottom: '10%', right: '10%' }}
                />
            </div>

            {/* Grid pattern overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>

            {/* Content */}
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center mt-16">
                <div className="animate-[fadeInUp_0.8s_ease-out]">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-violet-500/10 backdrop-blur-md rounded-full border border-violet-500/30 mb-8 shadow-[0_0_15px_rgba(124,58,237,0.15)]">
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm text-cyan-50 tracking-wide font-medium">AI 影视工业级生产流水线工具</span>
                    </div>

                    <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-6 tracking-tight">
                        魔片漫创
                        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-cyan-400 to-indigo-400 mt-2 drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                            Mopian Creator
                        </span>
                    </h1>

                    <p className="text-xl sm:text-2xl text-slate-300 mb-4 max-w-3xl mx-auto font-medium">
                        为漫剧而生！一站式 AI 漫剧创作平台
                    </p>

                    <p className="text-lg text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
                        支持 Seedance 2.0 多模态创作，从剧本解析到 S 级成片<br />
                        全流程批量化智能生产，开启漫剧创作新纪元
                    </p>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                        <Button
                            size="lg"
                            className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white px-8 py-6 text-lg group cursor-pointer border-0 shadow-[0_0_25px_rgba(124,58,237,0.4)] hover:shadow-[0_0_35px_rgba(6,182,212,0.6)] transition-all"
                            onClick={() => navigate('/home')}
                        >
                            立即开始创作
                            <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Button>
                        <Button size="lg" variant="outline" className="bg-slate-900/50 backdrop-blur-md border-indigo-500/30 text-slate-200 hover:bg-indigo-500/20 hover:text-white px-8 py-6 text-lg cursor-pointer">
                            观看演示
                        </Button>
                    </div>
                </div>

                {/* Feature tags */}
                <div className="mt-16 flex flex-wrap justify-center gap-4 text-sm animate-[fadeInUp_0.8s_ease-out_0.3s] opacity-0 [animation-fill-mode:forwards]">
                    {['剧本解析', '角色一致性', '多视角场景', '专业分镜系统', '统筹式导演', 'S级成片'].map((tag, index) => (
                        <span
                            key={index}
                            className="px-4 py-2 bg-slate-900/60 backdrop-blur-md rounded-full border border-indigo-500/20 text-slate-300 shadow-[0_4px_10px_rgba(0,0,0,0.3)] hover:border-cyan-500/40 hover:text-cyan-300 transition-colors cursor-default"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            </div>

            {/* Scroll indicator */}
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-[scrollBounce_2s_infinite]">
                <div className="w-6 h-10 border-2 border-indigo-500/30 rounded-full flex items-start justify-center p-2 opacity-60">
                    <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                </div>
            </div>
        </section>
    );
}
