import { TrendingUp, Users, PlayCircle, Film } from 'lucide-react';

export function Stats() {
    const stats = [
        {
            icon: PlayCircle,
            value: '50亿+',
            label: '累计播放量',
            color: 'from-violet-500 to-fuchsia-500'
        },
        {
            icon: Film,
            value: '10万+',
            label: '漫剧作品',
            color: 'from-cyan-500 to-blue-500'
        },
        {
            icon: Users,
            value: '5万+',
            label: '创作者',
            color: 'from-emerald-400 to-teal-500'
        },
        {
            icon: TrendingUp,
            value: '95%',
            label: '客户满意度',
            color: 'from-amber-400 to-orange-500'
        }
    ];

    return (
        <section className="py-20 bg-slate-950 border-t border-indigo-500/10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16 landing-fade-in">
                    <h2 className="text-4xl font-bold text-white mb-4 tracking-tight">
                        值得信赖的创作平台
                    </h2>
                    <p className="text-slate-400 text-lg">
                        数据见证我们的成长与实力
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                    {stats.map((stat, index) => (
                        <div
                            key={index}
                            className="relative group landing-fade-in hover:-translate-y-1 hover:scale-[1.03] transition-all duration-300"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-8 border border-white/5 hover:border-indigo-500/30 transition-all shadow-xl hover:shadow-[0_10px_30px_rgba(124,58,237,0.1)]">
                                {/* Icon */}
                                <div className={`inline-flex p-4 rounded-xl bg-gradient-to-br ${stat.color} mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                                    <stat.icon className="w-8 h-8 text-white" />
                                </div>

                                {/* Value */}
                                <div className="text-4xl font-bold text-white mb-2 tracking-tight">
                                    {stat.value}
                                </div>

                                {/* Label */}
                                <div className="text-slate-400 font-medium">
                                    {stat.label}
                                </div>

                                {/* Glow effect on hover */}
                                <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-0 group-hover:opacity-[0.03] rounded-2xl transition-opacity pointer-events-none`}></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
