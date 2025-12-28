import { expect } from 'chai';
import * as path from 'path';

/**
 * 单元测试：路径处理工具函数
 * 这些测试不需要 VSCode 环境，可以独立运行
 */

describe('路径处理工具函数', () => {
  describe('normalizeRel', () => {
    // 模拟 normalizeRel 函数
    function normalizeRel(p: string): string {
      let r = (p || '').trim();
      r = r.replace(/\\/g, '/');
      r = r.replace(/^\.\//, '');
      r = r.replace(/^\/+/, '');
      if (process.platform === 'win32') r = r.toLowerCase();
      return r;
    }

    it('应该移除前导 ./', () => {
      expect(normalizeRel('./images/test.png')).to.equal('images/test.png');
    });

    it('应该移除前导 /', () => {
      expect(normalizeRel('/images/test.png')).to.equal('images/test.png');
    });

    it('应该将反斜杠转换为正斜杠', () => {
      expect(normalizeRel('images\\test.png')).to.equal('images/test.png');
    });

    it('应该处理空字符串', () => {
      expect(normalizeRel('')).to.equal('');
    });

    it('应该去除首尾空格', () => {
      expect(normalizeRel('  images/test.png  ')).to.equal('images/test.png');
    });
  });

  describe('isWSL', () => {
    // 模拟 isWSL 函数
    function isWSL(): boolean {
      if (process.platform !== 'linux') return false;
      try {
        if (process.env.WSL_DISTRO_NAME) return true;
        const rel = require('os').release?.() || '';
        if (/microsoft/i.test(rel)) return true;
      } catch {}
      return false;
    }

    it('在非 Linux 平台应该返回 false', () => {
      if (process.platform !== 'linux') {
        expect(isWSL()).to.be.false;
      }
    });

    it('在 Linux 平台应该检查 WSL 标识', () => {
      if (process.platform === 'linux') {
        const result = isWSL();
        expect(result).to.be.a('boolean');
      }
    });
  });

  describe('winPathToWSL', () => {
    // 模拟 winPathToWSL 函数
    function winPathToWSL(p: string): string {
      const m = /^([a-zA-Z]):[\\\/](.*)$/.exec(p);
      if (!m) return p;
      const drive = m[1].toLowerCase();
      const rest = m[2].replace(/\\/g, '/');
      return `/mnt/${drive}/${rest}`;
    }

    it('应该将 Windows 路径转换为 WSL 路径', () => {
      expect(winPathToWSL('C:\\Users\\test')).to.equal('/mnt/c/Users/test');
      expect(winPathToWSL('D:\\Projects\\app')).to.equal('/mnt/d/Projects/app');
    });

    it('应该处理正斜杠的 Windows 路径', () => {
      expect(winPathToWSL('C:/Users/test')).to.equal('/mnt/c/Users/test');
    });

    it('对于非 Windows 路径应该返回原值', () => {
      expect(winPathToWSL('/home/user')).to.equal('/home/user');
    });
  });

  describe('wslPathToWin', () => {
    // 模拟 wslPathToWin 函数
    function wslPathToWin(p: string): string {
      const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p);
      if (!m) return p;
      const drive = m[1].toUpperCase();
      const rest = m[2].replace(/\//g, '\\');
      return `${drive}:\\${rest}`;
    }

    it('应该将 WSL 路径转换为 Windows 路径', () => {
      expect(wslPathToWin('/mnt/c/Users/test')).to.equal('C:\\Users\\test');
      expect(wslPathToWin('/mnt/d/Projects/app')).to.equal('D:\\Projects\\app');
    });

    it('对于非 WSL 挂载路径应该返回原值', () => {
      expect(wslPathToWin('/home/user')).to.equal('/home/user');
    });
  });

  describe('parseCommentTokenRules', () => {
    // 模拟 parseCommentTokenRules 函数
    function parseCommentTokenRules(rules: string[] | undefined): Record<string, string> {
      const map: Record<string, string> = {};
      if (!rules || !Array.isArray(rules)) return map;
      for (const raw of rules) {
        const s = String(raw || '').trim();
        if (!s) continue;
        const m = /^\{([^}]+)\}\s*-\s*(?:\{([^}]+)\}|(.+))$/u.exec(s);
        if (!m) continue;
        const left = m[1];
        const right = (m[2] ?? m[3] ?? '').trim();
        if (!right) continue;
        const exts = left.split(',').map(x => x.trim()).filter(Boolean);
        for (const ext of exts) {
          const key = ext.replace(/^\./, '').toLowerCase();
          if (!key) continue;
          map[key] = right;
        }
      }
      return map;
    }

    it('应该解析单个规则', () => {
      const rules = ['{js,ts}-{//}'];
      const result = parseCommentTokenRules(rules);
      expect(result).to.deep.equal({ js: '//', ts: '//' });
    });

    it('应该解析多个规则', () => {
      const rules = [
        '{js,ts}-{//}',
        '{py,sh}-{#}'
      ];
      const result = parseCommentTokenRules(rules);
      expect(result).to.deep.equal({
        js: '//',
        ts: '//',
        py: '#',
        sh: '#'
      });
    });

    it('应该处理带花括号的 token', () => {
      const rules = ['{lua,sql}-{--}'];
      const result = parseCommentTokenRules(rules);
      expect(result).to.deep.equal({ lua: '--', sql: '--' });
    });

    it('应该忽略无效规则', () => {
      const rules = ['invalid', '', '{js}-'];
      const result = parseCommentTokenRules(rules);
      expect(result).to.deep.equal({});
    });

    it('应该处理空数组', () => {
      const result = parseCommentTokenRules([]);
      expect(result).to.deep.equal({});
    });

    it('应该处理 undefined', () => {
      const result = parseCommentTokenRules(undefined);
      expect(result).to.deep.equal({});
    });
  });
});
