import { Play, Eye, Heart } from 'lucide-react';
import { ImageWithFallback } from './ImageWithFallback';

export function Works() {
    const works = [
        {
            id: 1,
            title: '星辰之恋',
            category: '言情漫剧',
            views: '8520万',
            likes: '126万',
            image: 'https://images.unsplash.com/photo-1705831156575-a5294d295a31?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtYW5nYSUyMGNvbWljJTIwYXJ0d29yayUyMHZpYnJhbnR8ZW58MXx8fHwxNzcxOTA2OTExfDA&ixlib=rb-4.1.0&q=80&w=1080'
        },
        {
            id: 2,
            title: '都市修仙传',
            category: '玄幻漫剧',
            views: '1.2亿',
            likes: '280万',
            image: 'https://images.unsplash.com/photo-1741746239350-9021ddfa3d59?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjcmVhdGl2ZSUyMHN0dWRpbyUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzcxOTA2OTExfDA&ixlib=rb-4.1.0&q=80&w=1080'
        },
        {
            id: 3,
            title: '重生豪门',
            category: '都市漫剧',
            views: '9800万',
            likes: '195万',
            image: 'https://images.unsplash.com/photo-1764601841403-5c43713923c7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkaWdpdGFsJTIwYXJ0JTIwY3JlYXRpb24lMjBzY2VuZXxlbnwxfHx8fDE3NzE5MDY5MTF8MA&ixlib=rb-4.1.0&q=80&w=1080'
        }
    ];

    return (
        <section id="works" className="py-24 bg-slate-950 border-t border-indigo-500/10 relative overflow-hidden">
            {/* Background glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-violet-600/5 rounded-full blur-[150px] pointer-events-none"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="text-center mb-16 landing-fade-in">
                    <div className="inline-block px-4 py-2 bg-pink-500/10 backdrop-blur-md rounded-full border border-pink-500/30 mb-6 shadow-[0_0_15px_rgba(236,72,153,0.15)]">
                        <span className="text-sm text-pink-400 font-medium">精品案例</span>
                    </div>
                    <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6 tracking-tight">
                        爆款漫剧，从这里诞生
                    </h2>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                        数千部优质作品见证平台实力，每一帧都是精心打造
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {works.map((work, index) => (
                        <div
                            key={work.id}
                            className="group relative cursor-pointer landing-fade-in hover:-translate-y-2 transition-all duration-300"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl transition-all duration-300 group-hover:shadow-[0_20px_40px_rgba(124,58,237,0.2)]">
                                {/* Image */}
                                <div className="aspect-[3/4] relative overflow-hidden">
                                    <ImageWithFallback
                                        src={work.image}
                                        alt={work.title}
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out"
                                    />

                                    {/* Overlay background */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/60 to-transparent opacity-80 group-hover:opacity-90 transition-opacity duration-300"></div>

                                    {/* Play button */}
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100">
                                        <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-transform hover:scale-110">
                                            <Play className="w-10 h-10 text-cyan-400 fill-cyan-400 ml-1 drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                                        </div>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
                                    <div className="mb-3">
                                        <span className="inline-block px-3 py-1 bg-violet-600/20 border border-violet-500/40 backdrop-blur-md rounded-full text-xs text-violet-300 font-medium tracking-wide">
                                            {work.category}
                                        </span>
                                    </div>

                                    <h3 className="text-2xl font-bold text-white mb-3 tracking-tight group-hover:text-cyan-300 transition-colors">
                                        {work.title}
                                    </h3>

                                    <div className="flex items-center gap-6 text-sm text-slate-300 font-medium">
                                        <div className="flex items-center gap-1.5">
                                            <Eye className="w-4 h-4 text-slate-400" />
                                            <span>{work.views}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <Heart className="w-4 h-4 text-pink-500" />
                                            <span>{work.likes}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Border glow effect */}
                                <div className="absolute inset-0 rounded-2xl border-2 border-transparent group-hover:border-cyan-500/40 transition-colors duration-300 pointer-events-none"></div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* View more button */}
                <div className="text-center mt-16 landing-fade-in" style={{ animationDelay: '400ms' }}>
                    <button className="px-8 py-4 bg-slate-900 border border-indigo-500/50 text-white rounded-full transition-all hover:bg-slate-800 hover:shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:border-cyan-500/50 font-medium cursor-pointer">
                        查看更多作品
                    </button>
                </div>
            </div>
        </section>
    );
}
