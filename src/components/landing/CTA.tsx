import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export function CTA() {
    const navigate = useNavigate();

    return (
        <section className="py-24 relative overflow-hidden bg-gradient-to-br from-violet-900 via-fuchsia-900 to-indigo-900">
            {/* Animated background blobs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div
                    className="absolute w-[600px] h-[600px] bg-white/10 rounded-full blur-[120px] animate-[pulse_8s_ease-in-out_infinite]"
                    style={{
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                    }}
                />
            </div>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
                <div className="landing-fade-in">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/20 mb-8">
                        <Sparkles className="w-4 h-4 text-violet-300" />
                        <span className="text-sm text-white font-medium tracking-wide">
                            立即体验 AI 漫剧创作
                        </span>
                    </div>

                    <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6 tracking-tight">
                        开启您的漫剧创作之旅
                    </h2>

                    <p className="text-xl text-gray-200 mb-10 max-w-2xl mx-auto leading-relaxed">
                        加入数万创作者的行列，用 AI 技术让创意变为现实
                        <br />
                        现在注册，即可获得 100 积分免费额度
                    </p>

                    <div className="flex justify-center">
                        <Button
                            size="lg"
                            className="bg-white text-violet-900 hover:bg-gray-100 px-10 py-7 text-lg font-bold group cursor-pointer border-0 rounded-full shadow-xl hover:shadow-2xl transition-all"
                            onClick={() => navigate('/home')}
                        >
                            免费开始创作
                            <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    </div>

                    <p className="text-sm text-gray-300 mt-8 font-medium">
                        无需信用卡 · 随时取消 · 7x24 技术支持
                    </p>
                </div>
            </div>
        </section>
    );
}
