# Original, fully procedural pixel art for the Tackle Tactics Korean fork.
# No third-party art is read or copied. CC0 / free to reuse.
import math, os, random, sys
from PIL import Image, ImageDraw
OUT=sys.argv[1] if len(sys.argv)>1 else '/tmp/tt/public/assets'
def mk(*p):
    d=os.path.join(OUT,*p[:-1]); os.makedirs(d,exist_ok=True); return os.path.join(OUT,*p)
def hexc(h,a=255):
    h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))+(a,)
def shade(c,f): return tuple(max(0,min(255,int(v*f))) for v in c[:3])+(c[3],)
# ---------- seamless grass / dirt tiles (64x64)
def tile(base,spec,seed,blades=True,dots=None):
    r=random.Random(seed); im=Image.new('RGBA',(64,64),hexc(base)); px=im.load()
    for _ in range(spec):
        x,y=r.randrange(64),r.randrange(64); f=r.choice([0.9,0.94,1.06,1.1])
        c=shade(hexc(base),f)
        for dy in range(r.choice([1,2,3]) if blades else 1):
            px[x%64,(y+dy)%64]=c
    if dots:
        for col,n in dots:
            for _ in range(n):
                x,y=r.randrange(64),r.randrange(64); px[x,y]=hexc(col)
    return im
G={'001':('#3f9a3a',420,1),'003':('#46a540',300,2),'006':('#2f7d30',420,3),'008':('#3a8f38',380,4),'015':('#357f34',380,5),'016':('#3d9439',380,6)}
for k,(b,n,s) in G.items(): tile(b,n,s).save(mk('tiles',f'grass_{k}.png'))
tile('#8a7a43',500,9,dots=[('#6f8a3a',140),('#a0904f',80)]).save(mk('tiles','grass_009.png'))
tile('#7c6b3a',600,10,dots=[('#5f7a35',160),('#948346',90)]).save(mk('tiles','grass_010.png'))
tile('#6e5f35',650,11,dots=[('#566b30',120),('#85753f',100)]).save(mk('tiles','grass_011.png'))
tile('#5f5030',650,12,dots=[('#4a5d2c',80),('#7a6a3a',120)]).save(mk('tiles','grass_012.png'))
tile('#4e402a',700,13,dots=[('#3a2e1f',150),('#65553a',120)]).save(mk('tiles','grass_013.png'))
tile('#58492c',700,14,dots=[('#43381f',150),('#6d5d38',100)]).save(mk('tiles','grass_014.png'))
# ---------- ball 32x32
def circ_ball(sz=32):
    s=sz*4; im=Image.new('RGBA',(s,s),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.ellipse((s*.06,s*.06,s*.94,s*.94),fill=hexc('#f4f4f2'),outline=hexc('#222831'),width=int(s*.05))
    cx=cy=s/2
    def pent(cx,cy,r,rot):
        return [(cx+r*math.cos(rot+i*2*math.pi/5),cy+r*math.sin(rot+i*2*math.pi/5)) for i in range(5)]
    d.polygon(pent(cx,cy,s*.16,-math.pi/2),fill=hexc('#222831'))
    for i in range(5):
        a=-math.pi/2+i*2*math.pi/5+math.pi/5
        d.polygon(pent(cx+s*.34*math.cos(a),cy+s*.34*math.sin(a),s*.09,a),fill=hexc('#222831'))
    return im.resize((sz,sz),Image.NEAREST if False else Image.LANCZOS)
circ_ball().save(mk('props','ball_classic.png'))
# ---------- goals 128x256 (side view, post line at x=95 left / x=33 right)
def goal(side,billow=0.0):
    im=Image.new('RGBA',(128,256),(0,0,0,0)); d=ImageDraw.Draw(im)
    px=95 if side=='left' else 33; dirn=-1 if side=='left' else 1
    top,bot=35,228
    depth=58; back=px+dirn*depth
    sag=int(billow)
    # net: quad from front frame back to a smaller back frame (top-down perspective)
    btop,bbot=top+22,bot-22
    net=hexc('#f2f2f2',120)
    poly=[(px,top),(back+dirn*sag,btop),(back+dirn*sag,bbot),(px,bot)]
    d.polygon(poly,fill=hexc('#ffffff',46))
    for i in range(0,depth+1,6):
        x=px+dirn*i; t=i/depth
        yt=top+(btop-top)*t; yb=bot+(bbot-bot)*t
        xs=x+dirn*int(sag*t)
        d.line((xs,yt,xs,yb),fill=net)
    for j in range(0,17):
        t=j/16; y0=top+(bot-top)*t; y1=btop+(bbot-btop)*t
        d.line((px,y0,back+dirn*sag,y1),fill=net)
    # frame
    W=hexc('#f6f6f6'); S=hexc('#9aa3ad')
    d.line((px,top,back+dirn*sag,btop),fill=S,width=3); d.line((px,bot,back+dirn*sag,bbot),fill=S,width=3)
    d.line((back+dirn*sag,btop,back+dirn*sag,bbot),fill=S,width=3)
    d.rectangle((px-3,top-3,px+3,bot+3),fill=W)
    d.rectangle((px-3,top-3,px+3,bot+3),outline=S)
    for y in (top,bot): d.ellipse((px-6,y-6,px+6,y+6),fill=W,outline=S)
    return im
for side in ('left','right'):
    goal(side).save(mk('props',f'goal_{side}.png'))
    strip=Image.new('RGBA',(128*24,256),(0,0,0,0))
    for f in range(24):
        t=f/23; b=22*math.sin(min(1,t*1.6)*math.pi)*(1-t*0.6)*math.exp(-3*max(0,t-0.35))
        strip.paste(goal(side,b*1.4),(f*128,0))
    strip.save(mk('fx',f'goal_{side}_net_billow.png'))
# ---------- trophies 64x64
def cup(main,dark,light,name):
    s=256; im=Image.new('RGBA',(s,s),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.polygon([(52,40),(204,40),(190,130),(150,170),(106,170),(66,130)],fill=main,outline=dark)
    d.arc((8,52,64,128),90,270,fill=dark,width=10); d.arc((192,52,248,128),270,90,fill=dark,width=10)
    d.rectangle((112,168,144,206),fill=dark); d.rectangle((84,206,172,230),fill=main,outline=dark)
    d.polygon([(70,48),(92,48),(100,128),(84,118)],fill=light)
    d.ellipse((108,70,148,110),fill=light)
    return im.resize((64,64),Image.LANCZOS)
cup(hexc('#f2c230'),hexc('#a97a10'),hexc('#fff2a8'),'g').save(mk('props','cup_gold.png'))
cup(hexc('#c9d1d9'),hexc('#7b8794'),hexc('#ffffff'),'s').save(mk('props','cup_silver.png'))
def medal(main,dark,light):
    s=256; im=Image.new('RGBA',(s,s),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.polygon([(80,10),(128,100),(176,10),(150,10),(128,50),(106,10)],fill=hexc('#2d62c8'))
    d.ellipse((60,100,196,236),fill=main,outline=dark,width=8); d.ellipse((84,124,172,212),outline=dark,width=6)
    d.polygon([(128,138),(138,162),(164,164),(144,180),(150,204),(128,190),(106,204),(112,180),(92,164),(118,162)],fill=light)
    return im.resize((64,64),Image.LANCZOS)
medal(hexc('#c9d1d9'),hexc('#7b8794'),hexc('#ffffff')).save(mk('props','medal_silver.png'))
medal(hexc('#f2c230'),hexc('#a97a10'),hexc('#fff2a8')).save(mk('props','medal_gold.png'))
# ---------- crowd 24 frames of 128x128 (seats + 2 rows of fans), tileable in x
PAL={'home':['#d63a3a','#f2f2f2','#a02323'],'away':['#2f6fd6','#f2d23a','#1f4a9a'],'mixed':['#d63a3a','#2f6fd6','#f2f2f2','#f2d23a']}
SKIN=['#f1c9a5','#d9a077','#a86c47','#7a4a2e']; HAIR=['#2a1c14','#5a3a1e','#c9a24a','#111111']
def fan(d,x,y,r,bob,col,arms):
    sk=hexc(r.choice(SKIN)); hr=hexc(r.choice(HAIR)); sh=hexc(col)
    yy=y-bob
    d.rectangle((x-9,yy+18,x+9,yy+40),fill=sh); d.rectangle((x-9,yy+18,x+9,yy+21),fill=shade(sh,1.2))
    d.rectangle((x-7,yy+2,x+7,yy+17),fill=sk); d.rectangle((x-8,yy,x+8,yy+6),fill=hr)
    d.rectangle((x-4,yy+9,x-3,yy+10),fill=hexc('#222222')); d.rectangle((x+3,yy+9,x+4,yy+10),fill=hexc('#222222'))
    if arms:
        d.rectangle((x-15,yy+2,x-10,yy+22),fill=sk); d.rectangle((x+10,yy+2,x+15,yy+22),fill=sk)
def crowd_frame(kind,f,empty=False):
    im=Image.new('RGBA',(128,128),hexc('#2a2f3a')); d=ImageDraw.Draw(im)
    for row in range(2):
        by=row*64; d.rectangle((0,by+44,127,by+63),fill=hexc('#3a4150')); d.rectangle((0,by+60,127,by+63),fill=hexc('#20242d'))
    if empty:
        for row in range(2):
            for i in range(4):
                x=16+i*32; by=row*64
                d.rectangle((x-12,by+28,x+12,by+52),fill=hexc('#4a5568'),outline=hexc('#20242d'))
        return im
    r=random.Random(77)
    cols=PAL[kind]
    for row in range(2):
        for i in range(4):
            seedp=r.random()*6.28; col=r.choice(cols); arms=r.random()<0.45; sk_=r.random()
            ph=f/24*2*math.pi
            bob=int(5*max(0,math.sin(ph+seedp))) if arms else int(2*max(0,math.sin(ph+seedp)))
            fan(d,16+i*32,row*64+10+(row==1)*0,random.Random(i*7+row*13),bob,col,arms and math.sin(ph+seedp)>0)
    return im
for kind in PAL:
    s=Image.new('RGBA',(128*24,128))
    for f in range(24): s.paste(crowd_frame(kind,f),(f*128,0))
    s.save(mk('stadium',f'fans_{kind}.png')); crowd_frame(kind,0,True).save(mk('stadium',f'seats_empty_{kind}.png'))
# ---------- ad boards 192x48 + LED 48 frames
FONT=None
def board(bg,fg,mark,seed):
    im=Image.new('RGBA',(192,48),hexc(bg)); d=ImageDraw.Draw(im)
    d.rectangle((0,0,191,47),outline=hexc('#10131a'),width=2); d.rectangle((2,2,189,6),fill=shade(hexc(bg),1.25))
    r=random.Random(seed)
    if mark=='stripes':
        for i in range(-2,14): d.polygon([(i*16,48),(i*16+10,48),(i*16+26,8),(i*16+16,8)],fill=hexc(fg))
    elif mark=='dots':
        for i in range(6):
            d.ellipse((12+i*30,14,36+i*30,38),fill=hexc(fg))
    elif mark=='bars':
        for i in range(12): d.rectangle((8+i*15,12+(i%3)*4,16+i*15,42),fill=hexc(fg))
    else:
        d.polygon([(0,24),(96,8),(192,24),(96,42)],fill=hexc(fg)); d.ellipse((76,16,116,34),fill=hexc(bg))
    return im
BO=[('#1d4fa3','#f2d23a','stripes'),('#c2332f','#ffffff','dots'),('#1f8a5a','#e9f5ee','bars'),('#222831','#f28a1e','diamond')]
for i,(b,f,m) in enumerate(BO,1): board(b,f,m,i).save(mk('stadium',f'ad_board_{i}.png'))
for i,(b,f,m) in enumerate(BO[:3],1):
    s=Image.new('RGBA',(192*48,48))
    for k in range(48):
        im=board(b,f,m,i); sh=int(k*4)%192
        im=Image.alpha_composite(im.convert('RGBA'),Image.new('RGBA',(192,48),(0,0,0,0)))
        a=im.crop((sh,0,192,48)); c=im.crop((0,0,sh,48)); n=Image.new('RGBA',(192,48)); n.paste(a,(0,0)); n.paste(c,(192-sh,0))
        d=ImageDraw.Draw(n)
        for y in range(8,48,4): d.line((0,y,191,y),fill=(0,0,0,40))
        s.paste(n,(k*192,0))
    s.save(mk('stadium',f'anim_led_board_{i}.png'))
# ---------- dugouts 192x112
def dugout(col,fn):
    im=Image.new('RGBA',(192,112),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rectangle((6,18,185,100),fill=hexc('#1b2230'))
    d.rectangle((6,18,185,22),fill=hexc(col)); d.polygon([(0,18),(191,18),(185,4),(6,4)],fill=hexc(col),outline=hexc('#10131a'))
    d.rectangle((10,26,181,34),fill=hexc('#7fb6e8',140),outline=hexc('#c8e2f7'))
    for i in range(7): d.rectangle((16+i*24,64,34+i*24,92),fill=shade(hexc(col),0.85),outline=hexc('#10131a'))
    d.rectangle((6,96,185,106),fill=hexc('#3a4150')); d.rectangle((0,100,191,111),fill=hexc('#2a2f3a'))
    return im
dugout('#c2332f',0).save(mk('stadium','dugout_home.png')); dugout('#1d4fa3',0).save(mk('stadium','dugout_away.png'))
# ---------- floodlights 96x256
def flood(on):
    im=Image.new('RGBA',(96,256),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rectangle((42,56,54,248),fill=hexc('#6b7380'),outline=hexc('#2a2f3a')); d.rectangle((30,244,66,254),fill=hexc('#3a4150'))
    d.rectangle((6,4,90,54),fill=hexc('#2a2f3a'),outline=hexc('#10131a'),width=2)
    for r_ in range(2):
        for c in range(4):
            x=12+c*20; y=9+r_*20
            d.ellipse((x,y,x+16,y+16),fill=hexc('#fffbd0') if on else hexc('#555b66'),outline=hexc('#10131a'))
    return im
flood(True).save(mk('stadium','floodlight_on.png')); flood(False).save(mk('stadium','floodlight_off.png'))
# ---------- tv camera gantry 64x80, scoreboard 192x144
im=Image.new('RGBA',(64,80),(0,0,0,0)); d=ImageDraw.Draw(im)
d.rectangle((26,40,38,76),fill=hexc('#4a5160')); d.rectangle((14,72,50,79),fill=hexc('#2a2f3a'))
d.rectangle((6,14,46,40),fill=hexc('#20242d'),outline=hexc('#10131a'),width=2); d.polygon([(46,20),(60,12),(60,42),(46,34)],fill=hexc('#10131a'))
d.ellipse((50,20,58,34),fill=hexc('#4aa3e8')); d.rectangle((10,18,18,22),fill=hexc('#e83a3a')); im.save(mk('stadium','tv_camera.png'))
im=Image.new('RGBA',(192,144),(0,0,0,0)); d=ImageDraw.Draw(im)
d.rectangle((86,100,106,140),fill=hexc('#4a5160')); d.rectangle((60,134,132,143),fill=hexc('#2a2f3a'))
d.rectangle((4,6,187,104),fill=hexc('#171b24'),outline=hexc('#6b7380'),width=4)
d.rectangle((12,14,179,96),fill=hexc('#0b0e14'))
for x in (24,148):
    d.rectangle((x,30,x+20,70),outline=hexc('#f2d23a'),width=3)
d.rectangle((86,40,106,46),fill=hexc('#f2d23a')); d.rectangle((86,54,106,60),fill=hexc('#f2d23a'))
d.rectangle((60,18,132,26),fill=hexc('#e83a3a')); d.rectangle((60,78,132,88),fill=hexc('#2f6fd6'))
im.save(mk('stadium','scoreboard.png'))
# ---------- corner flags 12 frames of 32x80
FL={'red':('#d63a3a','#ffffff'),'yellow':('#f2d23a','#d63a3a'),'checked':('#f2f2f2','#222831')}
for name,(a,b) in FL.items():
    s=Image.new('RGBA',(32*12,80))
    for f in range(12):
        im=Image.new('RGBA',(32,80),(0,0,0,0)); d=ImageDraw.Draw(im)
        d.rectangle((6,16,9,78),fill=hexc('#f2f2f2'),outline=hexc('#7b8794'))
        w=int(3*math.sin(f/12*2*math.pi)); 
        for cx in range(0,18):
            off=int(2.5*math.sin(f/12*2*math.pi-cx*0.5)); 
            for cy in range(0,12):
                col=hexc(a)
                if name=='checked': col=hexc(a if ((cx//3)+(cy//3))%2==0 else b)
                elif name=='red' and cy>=8: col=hexc(b)
                elif name=='yellow' and cx%6<2: col=hexc(b)
                d.point((10+cx,18+cy+off),fill=col)
        s.paste(im,(f*32,0))
    s.save(mk('stadium',f'anim_corner_flag_{name}.png'))
print('done')
