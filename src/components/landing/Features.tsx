import { FileText, Users as UsersIcon, Camera, Layers, Clapperboard, Sparkles } from 'lucide-react';

export function Features() {
    const features = [
        {
            icon: FileText,
            title: '剧本解析',
            description: '智能解析剧本结构，自动提取关键信息，快速生成分镜脚本',
            gradient: 'from-violet-500 to-fuchsia-500'
        },
        {
            icon: UsersIcon,
            title: '角色一致性',
            description: 'AI 驱动的角色形象管理，确保全剧角色外观统一协调',
            gradient: 'from-cyan-400 to-blue-600'
        },
        {
            icon: Camera,
            title: '多视角场景',
            description: '支持多机位、多角度场景生成，真实还原导演视角',
            gradient: 'from-teal-400 to-emerald-500'
        },
        {
            icon: Layers,
            title: '专业分镜系统',
            description: '影视级分镜编辑工具，精准控制每一帧画面，层层精修',
            gradient: 'from-amber-400 to-orange-500'
        },
        {
            icon: Clapperboard,
            title: '统筹式导演',
            description: 'AI 导演系统协调全局，把控全片节奏与情感表达深度',
            gradient: 'from-rose-500 to-red-600'
        },
        {
            icon: Sparkles,
            title: 'S级成片',
            description: '全流程批量化生产，稳定输出影视工业级高质量视听作品',
            gradient: 'from-indigo-500 to-violet-600'
        }
    ];

    return (
        <section id="features" className="py-24 bg-[#0A061E] relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute w-[600px] h-[600px] bg-violet-600/10 rounded-full blur-[120px]" style={{ top: '-10%', left: '-10%' }}></div>
                <div className="absolute w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[100px]" style={{ bottom: '-10%', right: '-5%' }}></div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="text-center mb-20 landing-fade-in">
                    <div className="inline-block px-4 py-2 bg-indigo-500/10 backdrop-blur-md rounded-full border border-indigo-500/30 mb-6 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
                        <span className="text-sm text-cyan-400 font-medium">核心功能</span>
                    </div>
                    <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6 tracking-tight">
                        AI 驱动的全流程创作
                    </h2>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto leading-relaxed">
                        从创意到成片，Mopian Creator 为您提供专业的漫剧创作工业化解决方案
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {features.map((feature, index) => (
                        <div
                            key={index}
                            className="group relative landing-fade-in hover:-translate-y-2 transition-all duration-300"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="h-full bg-slate-900/40 backdrop-blur-xl rounded-2xl p-8 border border-white/5 hover:border-indigo-500/40 transition-all shadow-xl hover:shadow-[0_15px_30px_rgba(124,58,237,0.15)]">
                                {/* Icon with gradient background */}
                                <div className={`inline-flex p-4 rounded-xl bg-gradient-to-br ${feature.gradient} mb-6 shadow-lg group-hover:scale-110 transition-transform`}>
                                    <feature.icon className="w-8 h-8 text-white" />
                                </div>

                                {/* Title */}
                                <h3 className="text-2xl font-bold text-white mb-4 tracking-tight">
                                    {feature.title}
                                </h3>

                                {/* Description */}
                                <p className="text-slate-400 leading-relaxed font-medium">
                                    {feature.description}
                                </p>

                                {/* Hover effect */}
                                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-[0.02] rounded-2xl transition-opacity pointer-events-none`}></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
