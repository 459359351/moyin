import { Github, Twitter, Youtube, Mail } from 'lucide-react';

export function Footer() {
    const footerLinks = {
        product: [
            { label: '功能介绍', href: '#' },
            { label: '定价方案', href: '#' },
            { label: '案例展示', href: '#' },
            { label: '更新日志', href: '#' }
        ],
        resources: [
            { label: '帮助中心', href: '#' },
            { label: '开发文档', href: '#' },
            { label: '视频教程', href: '#' },
            { label: 'API 文档', href: '#' }
        ],
        company: [
            { label: '关于我们', href: '#' },
            { label: '加入我们', href: '#' },
            { label: '联系方式', href: '#' },
            { label: '合作伙伴', href: '#' }
        ],
        legal: [
            { label: '服务条款', href: '#' },
            { label: '隐私政策', href: '#' },
            { label: '版权声明', href: '#' },
            { label: '许可协议', href: '#' }
        ]
    };

    const socialLinks = [
        { icon: Github, href: '#', label: 'GitHub' },
        { icon: Twitter, href: '#', label: 'Twitter' },
        { icon: Youtube, href: '#', label: 'YouTube' },
        { icon: Mail, href: '#', label: 'Email' }
    ];

    return (
        <footer className="bg-slate-950 border-t border-indigo-500/20 pt-16 pb-8 relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                {/* Main footer content */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
                    {/* Brand column */}
                    <div className="col-span-2 md:col-span-1">
                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_10px_rgba(124,58,237,0.4)]">
                                <span className="text-white font-bold tracking-tighter">MC</span>
                            </div>
                            <span className="text-xl font-bold text-white tracking-wide">魔片漫创</span>
                        </div>
                        <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                            为漫剧而生的 AI 工业级创作平台
                        </p>
                        <div className="flex gap-4">
                            {socialLinks.map((social) => (
                                <a
                                    key={social.label}
                                    href={social.href}
                                    className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:shadow-[0_0_15px_rgba(99,102,241,0.2)] transition-all"
                                    aria-label={social.label}
                                >
                                    <social.icon className="w-4 h-4" />
                                </a>
                            ))}
                        </div>
                    </div>

                    {/* Product links */}
                    <div className="md:ml-auto">
                        <h3 className="text-white font-semibold mb-6 tracking-wide">产品</h3>
                        <ul className="space-y-3">
                            {footerLinks.product.map((link) => (
                                <li key={link.label}>
                                    <a href={link.href} className="text-slate-400 hover:text-cyan-400 text-sm transition-colors font-medium">
                                        {link.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Resources links */}
                    <div className="md:ml-auto">
                        <h3 className="text-white font-semibold mb-6 tracking-wide">资源</h3>
                        <ul className="space-y-3">
                            {footerLinks.resources.map((link) => (
                                <li key={link.label}>
                                    <a href={link.href} className="text-slate-400 hover:text-cyan-400 text-sm transition-colors font-medium">
                                        {link.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Company links */}
                    <div className="md:ml-auto">
                        <h3 className="text-white font-semibold mb-6 tracking-wide">公司</h3>
                        <ul className="space-y-3">
                            {footerLinks.company.map((link) => (
                                <li key={link.label}>
                                    <a href={link.href} className="text-slate-400 hover:text-cyan-400 text-sm transition-colors font-medium">
                                        {link.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Legal links */}
                    <div className="md:ml-auto">
                        <h3 className="text-white font-semibold mb-6 tracking-wide">法律</h3>
                        <ul className="space-y-3">
                            {footerLinks.legal.map((link) => (
                                <li key={link.label}>
                                    <a href={link.href} className="text-slate-400 hover:text-cyan-400 text-sm transition-colors font-medium">
                                        {link.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Bottom bar */}
                <div className="pt-8 border-t border-slate-800/80 flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="text-slate-500 text-sm font-medium">
                        © 2026 魔片漫创 Mopian Creator. All rights reserved.
                    </p>
                    <div className="flex gap-6 text-sm text-slate-500 font-medium">
                        <a href="#" className="hover:text-slate-300 transition-colors">京ICP备xxxxxxxx号</a>
                        <a href="#" className="hover:text-slate-300 transition-colors">京公网安备xxxxxxxx号</a>
                    </div>
                </div>
            </div>
        </footer>
    );
}
