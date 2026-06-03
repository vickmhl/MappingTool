import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import pptxgen from 'pptxgenjs';

const outDir = path.resolve('outputs/dirty-stress-100p');
const company = '云图地图科技有限公司';

const departments = [
  ['导航与路线规划事业部', '导航算法副总裁'],
  ['地图数据平台部', '数据平台副总裁'],
  ['商业化与行业解决方案部', '商业化副总裁'],
  ['车载与出行生态部', '出行生态副总裁'],
  ['位置服务与AI能力部', '位置AI副总裁'],
  ['用户增长与运营部', '用户增长副总裁'],
  ['安全合规与质量治理部', '安全合规负责人'],
  ['组织与人才发展部', 'HRD'],
];

const teamNames = {
  导航与路线规划事业部: ['路线规划算法部', '导航体验产品部', '实时路况引擎部'],
  地图数据平台部: ['采集调度平台部', '地图渲染引擎部', 'POI数据治理部'],
  商业化与行业解决方案部: ['本地生活商业部', '政企解决方案部', '渠道客户成功部'],
  车载与出行生态部: ['车机产品部', '公交骑行导航部', '出行服务接入部'],
  位置服务与AI能力部: ['定位服务平台部', '时空AI平台部', '搜索推荐算法部'],
  用户增长与运营部: ['用户增长策略部', '会员运营部', '内容运营部'],
  安全合规与质量治理部: ['数据安全部', '质量评测平台部', '应急保障部'],
  组织与人才发展部: ['HRBP团队', '招聘配置团队', '学习发展团队'],
};

const titleByTeam = {
  路线规划算法部: ['高级路径算法专家', '路线规划工程师', '交通预测算法工程师'],
  导航体验产品部: ['导航产品专家', '高级交互设计师', '路线体验产品经理'],
  实时路况引擎部: ['实时路况架构师', '交通数据工程师', '路况策略工程师'],
  采集调度平台部: ['采集调度专家', '众包平台产品经理', '调度平台工程师'],
  地图渲染引擎部: ['地图渲染专家', '前端地图工程师', '三维地图工程师'],
  POI数据治理部: ['POI治理专家', '数据质量工程师', '标签体系产品经理'],
  本地生活商业部: ['商业策略经理', '行业运营专家', '商户增长产品经理'],
  政企解决方案部: ['政企方案专家', '项目交付经理', '解决方案架构师'],
  渠道客户成功部: ['客户成功经理', '渠道运营专家', 'KA运营经理'],
  车机产品部: ['车机产品专家', '座舱导航产品经理', '车载生态工程师'],
  公交骑行导航部: ['公交导航产品经理', '骑行体验设计师', '公共出行运营专家'],
  出行服务接入部: ['服务接入架构师', '出行平台工程师', '司机生态运营专家'],
  定位服务平台部: ['定位算法专家', '定位平台工程师', '室内定位产品经理'],
  时空AI平台部: ['时空AI算法专家', 'AI平台工程师', '模型评测工程师'],
  搜索推荐算法部: ['搜索排序专家', '推荐算法工程师', '召回策略工程师'],
  用户增长策略部: ['增长策略专家', '活动增长产品经理', '实验平台分析师'],
  会员运营部: ['会员运营专家', '权益产品经理', '用户生命周期运营'],
  内容运营部: ['内容策略专家', 'UGC运营经理', '生态内容审核经理'],
  数据安全部: ['数据安全专家', '隐私合规工程师', '权限治理产品经理'],
  质量评测平台部: ['质量评测专家', '自动化测试工程师', '体验评测分析师'],
  应急保障部: ['应急保障专家', '稳定性工程师', '值班运营经理'],
  HRBP团队: ['HRBP', '组织发展专家', '员工关系专家'],
  招聘配置团队: ['招聘经理', '高级招聘顾问', '人才mapping顾问'],
  学习发展团队: ['学习发展专家', '人才梯队项目经理', '培训运营经理'],
};

const surnames = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏章顾侯邵孟龙段石程陆叶'.split('');
const givenNames = [
  '知行',
  '承泽',
  '亦航',
  '清越',
  '语涵',
  '怀瑾',
  '洛川',
  '南乔',
  '予安',
  '景曜',
  '明谦',
  '嘉树',
  '若溪',
  '星河',
  '雨乔',
  '言蹊',
  '启明',
  '青禾',
  '怀远',
  '舒然',
  '沐阳',
  '书辰',
  '思远',
  '嘉言',
  '晏清',
  '庭深',
  '子默',
  '若澄',
  '向南',
  '言川',
  '清扬',
  '谨言',
  '知夏',
  '星澜',
  '泽远',
  '云舟',
  '亦然',
  '怀真',
  '清辞',
  '嘉禾',
  '明远',
  '南栀',
  '若白',
  '庭安',
  '承意',
  '子衿',
  '云深',
  '思衡',
  '千寻',
  '景行',
  '知微',
  '临川',
  '语桐',
  '若安',
  '云岫',
  '青临',
  '星野',
  '怀宁',
  '予笙',
  '明珩',
  '景澄',
  '言舟',
  '嘉木',
  '若川',
  '知南',
  '清浅',
  '明棠',
  '书禾',
  '庭月',
  '向晚',
  '云起',
  '亦舒',
  '听澜',
  '景初',
  '怀序',
  '清和',
  '若临',
  '子清',
  '闻溪',
  '砚舟',
  '星辞',
  '明榆',
  '青禾',
  '怀瑾',
  '承泽',
  '予安',
  '言蹊',
  '若溪',
  '语涵',
  '星河',
  '雨乔',
  '洛川',
  '南乔',
  '知行',
  '亦航',
  '清越',
  '启明',
];

function makeName(index) {
  return `${surnames[index % surnames.length]}${givenNames[index % givenNames.length]}${index >= 90 ? index % 10 : ''}`;
}

const people = [];
let nameIndex = 0;

const top = {
  name: makeName(nameIndex++),
  company,
  department: '地图云事业群',
  title: '地图云事业群总经理',
  manager: '',
  level: 'L0',
};
people.push(top);

for (const [department, leadTitle] of departments) {
  const departmentLead = {
    name: makeName(nameIndex++),
    company,
    department,
    title: leadTitle,
    manager: top.name,
    level: 'L1',
  };
  people.push(departmentLead);

  for (const team of teamNames[department]) {
    const teamLead = {
      name: makeName(nameIndex++),
      company,
      department: team,
      title: `${team}负责人`,
      manager: departmentLead.name,
      level: 'L2',
    };
    people.push(teamLead);

    for (let i = 0; i < 3; i += 1) {
      const titles = titleByTeam[team];
      people.push({
        name: makeName(nameIndex++),
        company,
        department: team,
        title: titles[i % titles.length],
        manager: teamLead.name,
        level: 'L3',
      });
    }
  }
}

const peopleByName = new Map(people.map((person) => [person.name, person]));
const relationships = people
  .filter((person) => person.manager)
  .map((person) => ({ subordinateName: person.name, managerName: person.manager }));

function peopleInDepartment(department) {
  return people.filter((person) => person.department === department);
}

function buildComplexTranscript() {
  const lines = [
    `以下为虚拟脏数据，只用于测试上传解析和确认队列，不代表任何真实公司。公司统一写作：${company}。`,
    `HR口径：${top.name}现任${top.title}，下面八个一级部门都向${top.name}汇报。`,
  ];

  for (const [index, person] of people.entries()) {
    if (index === 0) continue;
    const prefix = index % 7 === 0 ? '候选人说有点记不清，但大概是：' : index % 5 === 0 ? '电话里听到的口径：' : '';
    const typo = index % 11 === 0 ? '（对方先说错成平台组，后面又改口）' : '';
    lines.push(`${prefix}${company}，${person.name}在${person.department}做${person.title}${typo}，${person.name} report to ${person.manager}。`);
  }

  for (const team of Object.values(teamNames).flat().slice(0, 12)) {
    const teamPeople = peopleInDepartment(team);
    const lead = teamPeople.find((person) => person.level === 'L2');
    const members = teamPeople.filter((person) => person.level === 'L3').map((person) => person.name);
    if (lead && members.length > 0) {
      lines.push(`${lead.name}下面有${members.join('、')}，其中${members[0]}最近被借调去支援跨部门项目。`);
    }
  }

  lines.push(`${people[17].name}已经离职，HRBP说系统里还没更新。`);
  lines.push(`${people[41].name}从${people[41].department}加入${people[9].department}，但候选人口径不一定准。`);
  lines.push(`有一条冲突线索：${people[28].name}汇报给${people[3].name}，但另一段电话又说${people[28].name}汇报给${people[2].name}。`);
  lines.push(`噪音：现任、现在担任、负责、部门、岗位都不是人名，不能被当成人名。`);

  return lines.join('\n');
}

function buildMeetingMinutes() {
  const moved = [people[31], people[44], people[62], people[78]];
  const left = [people[17], people[53], people[86]];
  const lines = [
    '# 2026 Q2 云图地图科技人事会议记录（虚拟）',
    '',
    `参会：${top.name}、${people[1].name}、${people[5].name}、${people[29].name}、${people[93].name}。`,
    '',
    '## 组织调整',
    `- ${people[1].department}维持双负责人讨论，但正式一号位仍是${people[1].name}。`,
    `- ${people[9].department}扩编，${people[9].name}目前担任${people[9].title}，${people[9].name}汇报给${people[1].name}。`,
    `- ${people[33].department}近期裁员比例约 18%，${people[33].name}需要补充外部专家。`,
    '',
    '## 调岗与离职',
    ...moved.map((person, index) => `- ${person.name}从${person.department}调任${people[9 + index].department}，暂时仍向${person.manager}汇报。`),
    ...left.map((person) => `- ${person.name}已经离职，原岗位 ${person.title} 暂未补齐。`),
    '',
    '## 模糊和冲突',
    `- ${people[28].name}直属上级有两个说法：一说是${people[3].name}，一说是${people[2].name}，需要确认。`,
    `- ${people[74].name}的 title 有人叫高级专家，也有人叫架构师，先放待复核。`,
  ];
  return lines.join('\n');
}

function buildMappingVerbatims() {
  const candidates = [people[12], people[28], people[47], people[63], people[74], people[93], people[101]];
  const lines = ['# HR 与候选人 mapping 实录逐字稿（虚拟）', ''];
  for (const person of candidates) {
    const manager = peopleByName.get(person.manager);
    lines.push(`## 访谈：${person.name}`);
    lines.push(`HR：你简历上写的是${person.title}，现在还是在${person.department}吗？`);
    lines.push(`候选人：对，我现在在${person.department}做${person.title}，如果按正式组织算，我是挂在${manager?.name ?? top.name}下面。`);
    lines.push(`HR：你们团队大概几个人，谁是一号位？`);
    lines.push(`候选人：一号位是${manager?.name ?? top.name}，我们团队大概 12 到 18 人，最近 Q2 控 headcount。`);
    lines.push(`${person.name}直属上级是${manager?.name ?? top.name}，${person.name}在${person.department}做${person.title}。`);
    lines.push('');
  }
  lines.push(`HR追问：${people[28].name}到底向谁汇报？候选人：我理解是${people[2].name}，但是跨项目时也听${people[3].name}安排。`);
  return lines.join('\n');
}

function crc32(buffer) {
  let c = ~0;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createFallbackScreenshotPng() {
  const width = 1400;
  const height = 820;
  const data = Buffer.alloc(width * height * 4, 255);

  function pixel(x, y, color) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 4;
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = color[3] ?? 255;
  }

  function fillRect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) pixel(xx, yy, color);
    }
  }

  function line(x1, y1, x2, y2, color) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i += 1) {
      const x = Math.round(x1 + ((x2 - x1) * i) / steps);
      const y = Math.round(y1 + ((y2 - y1) * i) / steps);
      pixel(x, y, color);
      pixel(x + 1, y, color);
    }
  }

  fillRect(0, 0, width, height, [248, 251, 253, 255]);
  const lineColor = [128, 150, 166, 255];
  const blue = [33, 92, 187, 255];
  const card = [255, 255, 255, 255];
  const shadow = [230, 236, 240, 255];
  fillRect(610, 50, 180, 80, blue);
  line(700, 130, 700, 190, lineColor);
  line(120, 190, 1280, 190, lineColor);
  for (let i = 0; i < 8; i += 1) {
    const x = 80 + i * 165;
    line(x + 70, 190, x + 70, 245, lineColor);
    fillRect(x + 4, 250, 150, 74, shadow);
    fillRect(x, 244, 150, 74, card);
    fillRect(x, 244, 150, 8, [42, 123, 214, 255]);
    for (let j = 0; j < 3; j += 1) {
      const y = 375 + j * 130;
      line(x + 70, 318, x + 70, y, lineColor);
      fillRect(x + 4, y + 6, 150, 78, shadow);
      fillRect(x, y, 150, 78, card);
      fillRect(x, y, 150, 5, [130, 150, 166, 255]);
    }
  }

  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    rawRows.push(Buffer.from([0]));
    rawRows.push(data.subarray(y * width * 4, (y + 1) * width * 4));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rawRows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderRichScreenshot(mode, dataPath, outputPath) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'render-rich-org-image.ps1');
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-DataPath',
      dataPath,
      '-OutputPath',
      outputPath,
      '-Mode',
      mode,
    ],
    {
      stdio: 'pipe',
      encoding: 'utf8',
    },
  );
}

async function buildPptx(orgPngPath, notesPngPath) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Codex dirty stress generator';
  pptx.subject = '虚拟组织架构 mapping 脏数据';
  pptx.title = '云图地图科技组织 mapping 压力测试';

  const slide1 = pptx.addSlide();
  slide1.addText('云图地图科技组织 mapping 压力测试', { x: 0.5, y: 0.35, w: 12, h: 0.45, fontSize: 22, bold: true });
  slide1.addText(`${top.name}现任${top.title}，${people[1].name}在${people[1].department}做${people[1].title}，${people[1].name}汇报给${top.name}。`, {
    x: 0.55,
    y: 1.0,
    w: 12,
    h: 0.45,
    fontSize: 13,
  });
  slide1.addText(`${people[2].name}在${people[2].department}做${people[2].title}，${people[2].name} report to ${people[1].name}。${people[3].name}在${people[3].department}做${people[3].title}，${people[3].name}汇报给${people[2].name}。`, {
    x: 0.55,
    y: 1.55,
    w: 12,
    h: 0.55,
    fontSize: 12,
  });

  const slide2 = pptx.addSlide();
  slide2.addText('截图型组织图页：内置高信息密度组织图截图，应触发图片页复核提醒', {
    x: 0.5,
    y: 0.25,
    w: 12,
    h: 0.35,
    fontSize: 18,
    bold: true,
  });
  slide2.addImage({ path: orgPngPath, x: 0.55, y: 0.75, w: 12.1, h: 6.4 });

  const slide3 = pptx.addSlide();
  slide3.addText('访谈与会议截图页：内置第二张资料截图，模拟 HR 原始笔记', {
    x: 0.5,
    y: 0.3,
    w: 12,
    h: 0.4,
    fontSize: 18,
    bold: true,
  });
  slide3.addImage({ path: notesPngPath, x: 0.55, y: 0.8, w: 12.1, h: 5.1 });
  slide3.addText(`${people[28].name}汇报给${people[3].name}，但另一条候选人口径说${people[28].name}汇报给${people[2].name}。${people[17].name}已经离职。`, {
    x: 0.55,
    y: 6.1,
    w: 12,
    h: 0.7,
    fontSize: 12,
  });

  await pptx.writeFile({ fileName: path.join(outDir, 'cloudmap-org-ppt-with-embedded-image.pptx') });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const orgPngPath = path.join(outDir, 'cloudmap-screenshot-org.png');
  const notesPngPath = path.join(outDir, 'cloudmap-screenshot-notes.png');

  await writeFile(path.join(outDir, 'cloudmap-complex-transcript-100p.txt'), buildComplexTranscript(), 'utf8');
  await writeFile(path.join(outDir, 'cloudmap-hr-meeting-minutes.md'), buildMeetingMinutes(), 'utf8');
  await writeFile(path.join(outDir, 'cloudmap-candidate-mapping-verbatims.txt'), buildMappingVerbatims(), 'utf8');
  const expectedPath = path.join(outDir, 'expected.json');
  await writeFile(
    expectedPath,
    JSON.stringify(
      {
        company,
        generatedAt: new Date().toISOString(),
        people,
        relationships,
        knownConflict: {
          subordinateName: people[28].name,
          possibleManagers: [people[3].name, people[2].name],
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  try {
    renderRichScreenshot('org', expectedPath, orgPngPath);
    renderRichScreenshot('notes', expectedPath, notesPngPath);
  } catch (error) {
    const fallback = createFallbackScreenshotPng();
    await writeFile(orgPngPath, fallback);
    await writeFile(notesPngPath, fallback);
    console.warn('Rich screenshot renderer failed, used fallback PNG:', error instanceof Error ? error.message : error);
  }

  await buildPptx(orgPngPath, notesPngPath);
  console.log(`Generated ${people.length} people and dirty files in ${outDir}`);
}

await main();
