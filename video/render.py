#!/usr/bin/env python3
from __future__ import annotations
import math, random, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
GEN = ROOT / 'generated'
SEG = ROOT / 'segments'
OUT = ROOT / 'output'
EXPORTS = ROOT / 'exports'
FOOTAGE = ROOT / 'public' / 'footage'
for p in (GEN, SEG, OUT, EXPORTS, OUT / 'review-frames'):
    p.mkdir(parents=True, exist_ok=True)

W, H, FPS = 1920, 1080, 30
BG = '#071019'
PANEL = '#0d1722'
PANEL2 = '#111d2a'
BORDER = '#26384c'
TEXT = '#f3f6f9'
MUTED = '#93a4b8'
ACCENT = '#75a9e8'
ACCENT2 = '#9fc4f2'
HUMAN = '#e8c37a'
AGENT = '#8fb3ea'
DANGER = '#df6f79'
SUCCESS = '#7fc39c'
GRID = '#21364c'
FONT_REG = '/usr/share/fonts/opentype/inter/Inter-Regular.otf'
FONT_BOLD = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'


def font(size: int, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size=size)


def hex_rgba(value, alpha=255):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, size, fill=TEXT, bold=False, anchor=None, spacing=8, align='left'):
    draw.multiline_text(xy, value, font=font(size, bold), fill=fill, anchor=anchor, spacing=spacing, align=align)


def arrow(draw, start, end, color=ACCENT, width=4, head=14):
    ax, ay = start
    bx, by = end
    draw.line((ax, ay, bx, by), fill=color, width=width)
    angle = math.atan2(by - ay, bx - ax)
    p1 = (bx - head * math.cos(angle - math.pi / 6), by - head * math.sin(angle - math.pi / 6))
    p2 = (bx - head * math.cos(angle + math.pi / 6), by - head * math.sin(angle + math.pi / 6))
    draw.polygon([end, p1, p2], fill=color)


def network_bg(seed=3553, density=34, opacity=110):
    random.seed(seed)
    image = Image.new('RGBA', (W, H), hex_rgba(BG))
    draw = ImageDraw.Draw(image, 'RGBA')
    points = [(random.randint(80, W - 80), random.randint(70, H - 70)) for _ in range(density)]
    for i, (x, y) in enumerate(points):
        neighbors = sorted([
            (math.hypot(x - x2, y - y2), j, x2, y2)
            for j, (x2, y2) in enumerate(points) if j != i
        ])[:2]
        for distance, j, x2, y2 in neighbors:
            if i < j and distance < 430:
                draw.line((x, y, x2, y2), fill=hex_rgba(GRID, opacity // 2), width=2)
    for x, y in points:
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=hex_rgba('#4f7298', opacity), outline=hex_rgba('#8aa7c8', opacity), width=1)
    shade = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    shade_draw = ImageDraw.Draw(shade, 'RGBA')
    shade_draw.rectangle((0, 0, W, 150), fill=(2, 7, 11, 120))
    shade_draw.rectangle((0, H - 160, W, H), fill=(2, 7, 11, 110))
    return Image.alpha_composite(image, shade)


def save_title():
    image = network_bg(5, 30, 90)
    draw = ImageDraw.Draw(image, 'RGBA')
    text(draw, (W // 2, 440), 'InfraTwin', 82, TEXT, True, 'mm')
    draw.rounded_rectangle((750, 508, 1170, 512), radius=2, fill=hex_rgba(ACCENT, 210))
    text(draw, (W // 2, 566), 'Plan network changes before production.', 34, ACCENT2, False, 'mm')
    text(draw, (W // 2, 980), 'OpenAI WebMCP Challenge', 19, MUTED, False, 'mm')
    image.convert('RGB').save(GEN / 'title.png')


def save_problem():
    image = network_bg(12, 30, 70)
    draw = ImageDraw.Draw(image, 'RGBA')
    rounded(draw, (205, 236, 1715, 838), 28, hex_rgba('#08131e', 225), hex_rgba(BORDER, 220), 2)
    text(draw, (270, 300), 'NETWORK CHANGE RISK', 22, MUTED, True)
    text(draw, (270, 380), 'One maintenance change can\noverload infrastructure hundreds\nof miles away.', 66, TEXT, True, spacing=14)
    y = 735
    for i, (label, color) in enumerate([('maintenance', HUMAN), ('traffic', AGENT), ('remote failure', DANGER)]):
        x = 300 + i * 480
        rounded(draw, (x, y, x + 300, y + 72), 18, hex_rgba(PANEL2, 235), hex_rgba(color, 170), 2)
        text(draw, (x + 150, y + 36), label, 23, color, True, 'mm')
        if i < 2:
            arrow(draw, (x + 320, y + 36), (x + 455, y + 36), MUTED, 3, 11)
    image.convert('RGB').save(GEN / 'problem.png')


def shared_workspace(stage=4, export=False):
    image = network_bg(22, 22, 55)
    draw = ImageDraw.Draw(image, 'RGBA')
    text(draw, (120, 90), 'Why WebMCP?', 48, TEXT, True)
    text(draw, (120, 155), 'One live browser workspace — two kinds of agency.', 25, MUTED)
    if stage >= 2:
        rounded(draw, (540, 330, 1380, 600), 28, hex_rgba(PANEL, 245), hex_rgba(ACCENT, 190), 2)
        text(draw, (960, 390), 'NETWORK + CHANGE PLAN', 36, TEXT, True, 'mm')
        text(draw, (960, 450), 'same live page', 24, MUTED, False, 'mm')
        rounded(draw, (710, 500, 1210, 556), 18, hex_rgba('#14283b', 240), hex_rgba(ACCENT, 170), 1)
        text(draw, (960, 528), 'SAME LIVE CHANGE PLAN', 23, ACCENT2, True, 'mm')
    if stage >= 1:
        rounded(draw, (140, 290, 430, 452), 24, hex_rgba(PANEL2, 240), hex_rgba(HUMAN, 160), 2)
        text(draw, (285, 336), 'HUMAN', 24, HUMAN, True, 'mm')
        text(draw, (285, 386), 'click · select · constrain', 19, TEXT, False, 'mm')
    if stage >= 2:
        arrow(draw, (430, 372), (540, 420), HUMAN, 4, 14)
    if stage >= 3:
        rounded(draw, (1490, 290, 1780, 452), 24, hex_rgba(PANEL2, 240), hex_rgba(AGENT, 160), 2)
        text(draw, (1635, 336), 'WEBMCP AGENT', 24, AGENT, True, 'mm')
        text(draw, (1635, 386), 'inspect · edit · analyze', 19, TEXT, False, 'mm')
        arrow(draw, (1490, 372), (1380, 420), AGENT, 4, 14)
    if stage >= 4:
        rounded(draw, (610, 720, 1310, 872), 24, hex_rgba('#0b1620', 245), hex_rgba(SUCCESS, 150), 2)
        text(draw, (960, 760), 'DETERMINISTIC ENGINE', 24, SUCCESS, True, 'mm')
        text(draw, (960, 810), 'routing · failures · optimization · verification', 21, TEXT, False, 'mm')
        arrow(draw, (960, 600), (960, 720), SUCCESS, 4, 14)
        text(draw, (960, 940), 'evidence', 28, ACCENT2, True, 'mm')
        arrow(draw, (960, 872), (960, 918), SUCCESS, 4, 14)
    if export:
        image.convert('RGB').save(EXPORTS / 'shared-workspace-diagram.png')
    return image.convert('RGB')


def save_shared_workspace():
    for stage in range(1, 5):
        shared_workspace(stage).save(GEN / f'shared-{stage}.png')
    shared_workspace(4, True)


def save_trust():
    image = network_bg(33, 18, 45)
    draw = ImageDraw.Draw(image, 'RGBA')
    text(draw, (960, 210), 'Trust comes from evidence', 44, TEXT, True, 'mm')
    rounded(draw, (300, 390, 760, 610), 28, hex_rgba(PANEL, 245), hex_rgba(AGENT, 150), 2)
    text(draw, (530, 468), 'Agent reasoning', 32, AGENT, True, 'mm')
    arrow(draw, (790, 500), (1125, 500), ACCENT, 5, 18)
    rounded(draw, (1160, 390, 1620, 610), 28, hex_rgba(PANEL, 245), hex_rgba(SUCCESS, 150), 2)
    text(draw, (1390, 468), 'Machine-checkable', 29, SUCCESS, True, 'mm')
    text(draw, (1390, 516), 'evidence', 29, SUCCESS, True, 'mm')
    text(draw, (960, 760), 'routing · N-1 · HiGHS optimization · verification', 24, MUTED, False, 'mm')
    image.convert('RGB').save(GEN / 'trust.png')


def replan_loop(highlight=0, export=False):
    image = network_bg(44, 20, 42)
    draw = ImageDraw.Draw(image, 'RGBA')
    text(draw, (120, 90), 'Human judgment changes the design space', 46, TEXT, True)
    text(draw, (120, 155), 'A collaborative decision loop, not autonomous approval.', 24, MUTED)
    labels = [('AGENT PROPOSES', AGENT), ('HUMAN CONSTRAINS', HUMAN), ('INFRATWIN REPLANS', ACCENT), ('VERIFY', SUCCESS), ('HUMAN APPROVES', HUMAN)]
    xs = [100, 450, 820, 1215, 1535]
    widths = [280, 300, 330, 220, 285]
    cy = 520
    for i, ((label, color), x, item_width) in enumerate(zip(labels, xs, widths)):
        active = highlight == i + 1
        fill = hex_rgba('#142334' if active else PANEL, 250)
        outline = hex_rgba(color, 230 if active else 110)
        rounded(draw, (x, cy - 80, x + item_width, cy + 80), 24, fill, outline, 3 if active else 2)
        text(draw, (x + item_width / 2, cy), label, 23 if i != 2 else 21, color if active else TEXT, True, 'mm')
        if i < len(labels) - 1:
            arrow(draw, (x + item_width + 18, cy), (xs[i + 1] - 18, cy), ACCENT if i == 2 else MUTED, 3, 11)
    text(draw, (960, 790), 'constraint → stale proposal → adaptive alternative → verification', 24, MUTED, False, 'mm')
    if export:
        image.convert('RGB').save(EXPORTS / 'replan-loop-diagram.png')
    return image.convert('RGB')


def save_replan():
    replan_loop(0, True)
    for stage in range(1, 6):
        replan_loop(stage).save(GEN / f'replan-{stage}.png')


def save_performance():
    image = network_bg(55, 16, 35)
    draw = ImageDraw.Draw(image, 'RGBA')
    text(draw, (120, 105), 'Adaptive design acceleration', 46, TEXT, True)
    text(draw, (120, 165), 'Candidate-path generation after profiling and graph reuse', 24, MUTED)
    rounded(draw, (210, 310, 1710, 815), 34, hex_rgba(PANEL, 245), hex_rgba(BORDER, 220), 2)
    text(draw, (350, 388), '128 / 304 / 96', 28, MUTED, True)
    text(draw, (350, 510), '4.73 s', 58, TEXT, True)
    arrow(draw, (665, 532), (1080, 532), ACCENT, 6, 22)
    text(draw, (1140, 510), '0.51 s', 58, SUCCESS, True)
    text(draw, (1450, 510), '9.35×', 52, ACCENT2, True)
    draw.rounded_rectangle((350, 625, 1250, 653), radius=14, fill=hex_rgba('#27384b', 255))
    draw.rounded_rectangle((350, 625, 460, 653), radius=14, fill=hex_rgba(SUCCESS, 255))
    text(draw, (350, 710), '250 / 600 / 200', 22, MUTED, True)
    text(draw, (650, 710), '41.3 s → 4.0 s', 22, TEXT, True)
    text(draw, (960, 915), 'optimized TypeScript + graph reuse + caching · no native graph dependency required', 20, MUTED, False, 'mm')
    image.convert('RGB').save(GEN / 'performance.png')


def closing_stage(stage):
    image = network_bg(71, 28, 55).convert('RGBA')
    draw = ImageDraw.Draw(image, 'RGBA')
    if stage == 1:
        text(draw, (960, 150), 'A collaborative network decision twin', 42, TEXT, True, 'mm')
        rows = [('HUMAN', 'intent · constraints · approval', HUMAN), ('AGENT', 'exploration · alternatives', AGENT), ('INFRATWIN', 'deterministic evidence · optimization · verification', SUCCESS)]
        y = 355
        for name, description, color in rows:
            rounded(draw, (380, y - 60, 1540, y + 60), 24, hex_rgba(PANEL, 238), hex_rgba(color, 140), 2)
            text(draw, (500, y), name, 27, color, True, 'lm')
            text(draw, (830, y), description, 24, TEXT, False, 'lm')
            y += 170
    elif stage == 2:
        text(draw, (960, 350), 'Humans judge.  Agents explore.', 52, TEXT, True, 'mm')
        text(draw, (960, 440), 'InfraTwin proves.', 60, ACCENT2, True, 'mm')
        draw.rounded_rectangle((610, 530, 1310, 534), radius=2, fill=hex_rgba(ACCENT, 190))
        text(draw, (960, 650), 'Falsify bad changes before production.', 30, MUTED, False, 'mm')
    else:
        text(draw, (960, 350), 'InfraTwin', 78, TEXT, True, 'mm')
        text(draw, (960, 470), 'Plan first.  Falsify early.  Change safely.', 34, ACCENT2, True, 'mm')
        text(draw, (960, 675), 'Before you change the network,\nknow what the change will do.', 31, TEXT, False, 'mm', spacing=10, align='center')
        text(draw, (960, 950), 'WebMCP · browser-local · open source', 19, MUTED, False, 'mm')
        text(draw, (960, 995), 'Built for the OpenAI WebMCP Challenge', 18, MUTED, False, 'mm')
    return image.convert('RGB')


def save_closing():
    for stage in (1, 2, 3):
        closing_stage(stage).save(GEN / f'closing-{stage}.png')


def make_label(name, title, subtitle='', color=ACCENT, width=610):
    height = 94 if subtitle else 72
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, 'RGBA')
    rounded(draw, (0, 0, width - 1, height - 1), 18, (7, 16, 25, 226), hex_rgba(color, 185), 2)
    draw.rounded_rectangle((0, 0, 7, height), radius=3, fill=hex_rgba(color, 255))
    text(draw, (24, 17), title, 24, TEXT, True)
    if subtitle:
        text(draw, (24, 51), subtitle, 17, MUTED)
    image.save(GEN / name)


def save_labels():
    make_label('label-workspace.png', 'Browser-native network decision twin', 'Network + ChangePlan in one live browser workspace', ACCENT, 650)
    make_label('label-human.png', 'HUMAN', 'Schedule maintenance', HUMAN, 420)
    make_label('label-agent.png', 'AGENT via WebMCP', 'Add expected Payments growth', AGENT, 500)
    make_label('label-deterministic.png', 'Deterministic result', 'not model inference', DANGER, 480)
    make_label('label-constraint.png', 'Human constraint', 'protected modification target', HUMAN, 450)
    make_label('label-stale.png', 'Previous proposal → stale', 'plan restriction changed', DANGER, 470)
    make_label('label-replan.png', 'Adaptive replan', 'bounded routing + capacity design', ACCENT, 500)
    make_label('label-review.png', 'Human review', 'verified bounded alternatives', AGENT, 450)
    make_label('label-verify.png', 'Independent verification', 'reconstructed proposal evidence', SUCCESS, 500)
    make_label('label-scale.png', '500-node browser scale test', '500 nodes · 1,200 links · 400 demands', ACCENT, 570)
    make_label('label-webmcp.png', 'Native document.modelContext', 'dynamic semantic capabilities', AGENT, 560)


def run(command):
    print('+', ' '.join(str(value) for value in command))
    subprocess.run([str(value) for value in command], check=True)


def encode_still(image, duration, output, fade=True, motion=True):
    filters = []
    if motion:
        filters.append("scale=1960:1102,crop=1920:1080:x='(iw-ow)/2+8*sin(t*0.22)':y='(ih-oh)/2+4*cos(t*0.19)'")
    else:
        filters.append('scale=1920:1080')
    if fade:
        filters.append('fade=t=in:st=0:d=0.18')
        filters.append(f'fade=t=out:st={max(0, duration - 0.18):.3f}:d=0.18')
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', image, '-t', f'{duration:.3f}', '-vf', ','.join(filters), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', output])


def encode_clip(source, output, start=0.0, duration=None, speed=1.0, crop=None, overlays=None):
    inputs = ['-i', source]
    filters = []
    chain = []
    if crop:
        x, y, width, height = crop
        chain.extend([f'crop={width}:{height}:{x}:{y}', 'scale=1920:1080:flags=lanczos'])
    else:
        chain.append('scale=1920:1080')
    if speed != 1.0:
        chain.append(f'setpts=PTS/{speed:.8f}')
    filters.append('[0:v]' + ','.join(chain) + '[v0]')
    current = '[v0]'
    if overlays:
        for index, overlay in enumerate(overlays, start=1):
            inputs += ['-i', overlay['file']]
            output_tag = f'[v{index}]'
            x = overlay.get('x', 56)
            y = overlay.get('y', 930)
            enable = f"between(t,{overlay['start']:.3f},{overlay['end']:.3f})"
            filters.append(f"{current}[{index}:v]overlay=x={x}:y={y}:enable='{enable}'{output_tag}")
            current = output_tag
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    if start > 0:
        args += ['-ss', f'{start:.3f}']
    args += inputs
    if duration is not None:
        args += ['-t', f'{duration:.3f}']
    args += ['-filter_complex', ';'.join(filters), '-map', current, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', output]
    run(args)


def concat(parts, output):
    concat_file = GEN / 'concat.txt'
    concat_file.write_text('\n'.join(f"file '{part.as_posix()}'" for part in parts) + '\n')
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat_file, '-c', 'copy', '-movflags', '+faststart', output])


def render():
    save_title(); save_problem(); save_shared_workspace(); save_trust(); save_replan(); save_performance(); save_closing(); save_labels()
    parts = []
    output = SEG / '00-title.mp4'; encode_still(GEN / 'title.png', 3, output); parts.append(output)
    output = SEG / '01-problem.mp4'; encode_still(GEN / 'problem.png', 7, output); parts.append(output)
    output = SEG / '02-workspace.mp4'; encode_clip(FOOTAGE / '01-opening-workspace.mp4', output, speed=0.95, overlays=[{'file': GEN / 'label-workspace.png', 'start': 0.35, 'end': 5.35, 'x': 55, 'y': 915}]); parts.append(output)
    staged = []
    for stage in range(1, 5):
        staged_output = SEG / f'03a-shared-{stage}.mp4'; encode_still(GEN / f'shared-{stage}.png', 2.5, staged_output, fade=False, motion=False); staged.append(staged_output)
    output = SEG / '03-shared-webmcp.mp4'; concat(staged, output); parts.append(output)
    output = SEG / '04-human-agent.mp4'; encode_clip(FOOTAGE / '02-human-agent-plan.mp4', output, overlays=[{'file': GEN / 'label-human.png', 'start': 0.5, 'end': 8.0, 'x': 55, 'y': 930}, {'file': GEN / 'label-agent.png', 'start': 8.1, 'end': 16.2, 'x': 55, 'y': 910}]); parts.append(output)
    output = SEG / '05-failure.mp4'; encode_clip(FOOTAGE / '03-failure-evidence.mp4', output, crop=(35, 20, 1850, 1040), overlays=[{'file': GEN / 'label-deterministic.png', 'start': 0.45, 'end': 10.4, 'x': 55, 'y': 920}]); parts.append(output)
    output = SEG / '06-trust.mp4'; encode_still(GEN / 'trust.png', 6, output); parts.append(output)
    staged = []
    for stage in range(1, 6):
        staged_output = SEG / f'07a-replan-{stage}.mp4'; encode_still(GEN / f'replan-{stage}.png', 1.4, staged_output, fade=False, motion=False); staged.append(staged_output)
    output = SEG / '07-replan-diagram.mp4'; concat(staged, output); parts.append(output)
    output = SEG / '08-lock-replan.mp4'; encode_clip(FOOTAGE / '04-lock-and-replan.mp4', output, overlays=[{'file': GEN / 'label-constraint.png', 'start': 2.5, 'end': 7.2, 'x': 55, 'y': 920}, {'file': GEN / 'label-stale.png', 'start': 7.3, 'end': 13.2, 'x': 55, 'y': 920}, {'file': GEN / 'label-replan.png', 'start': 13.3, 'end': 21.7, 'x': 55, 'y': 910}]); parts.append(output)
    output = SEG / '09-performance.mp4'; encode_still(GEN / 'performance.png', 7, output); parts.append(output)
    compare = SEG / '10a-compare.mp4'; encode_clip(FOOTAGE / '05-compare-and-verify.mp4', compare, duration=9.15, crop=(390, 90, 1440, 810), overlays=[{'file': GEN / 'label-review.png', 'start': 0.4, 'end': 8.8, 'x': 55, 'y': 920}])
    verify = SEG / '10b-verify.mp4'; encode_clip(FOOTAGE / '05-compare-and-verify.mp4', verify, start=9.15, duration=7.183333, crop=(18, 10, 1884, 1060), overlays=[{'file': GEN / 'label-verify.png', 'start': 0.3, 'end': 6.9, 'x': 55, 'y': 910}])
    output = SEG / '10-compare-verify.mp4'; concat([compare, verify], output); parts.append(output)
    output = SEG / '11-scale.mp4'; encode_clip(FOOTAGE / '06-scale-proof.mp4', output, overlays=[{'file': GEN / 'label-scale.png', 'start': 0.5, 'end': 8.9, 'x': 55, 'y': 900}]); parts.append(output)
    output = SEG / '12-webmcp-proof.mp4'; encode_clip(FOOTAGE / '07-webmcp-proof.mp4', output, crop=(720, 180, 1200, 675), overlays=[{'file': GEN / 'label-webmcp.png', 'start': 0.35, 'end': 6.45, 'x': 55, 'y': 900}]); parts.append(output)
    closing1 = SEG / '13a-closing.mp4'; encode_still(GEN / 'closing-1.png', 10, closing1, fade=False, motion=True)
    closing2 = SEG / '13b-closing.mp4'; encode_still(GEN / 'closing-2.png', 8, closing2, fade=False, motion=True)
    closing3 = SEG / '13c-closing.mp4'; encode_still(GEN / 'closing-3.png', 10, closing3, fade=True, motion=True)
    output = SEG / '13-closing.mp4'; concat([closing1, closing2, closing3], output); parts.append(output)
    picture_master = OUT / 'InfraTwin-final-demo-no-audio.mp4'; concat(parts, picture_master)
    final = OUT / 'InfraTwin-final-demo.mp4'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', picture_master, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final])
    return final, picture_master


if __name__ == '__main__':
    final, picture_master = render()
    print(final)
