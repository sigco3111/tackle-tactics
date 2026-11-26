import math, os, sys
from PIL import Image, ImageDraw
S=64
OUT=(34,26,44,255)
def hexc(h,a=255): return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
SKIN=[hexc(x) for x in ('dba37c','b8805f','efc29c')]
HAIR=[hexc(x) for x in ('4a3426','33231a','644634')]
SHIRT=[hexc(x) for x in ('2f64c8','1e468f','5b8ae6')]
SHORT=[hexc(x) for x in ('f2f2f2','c4c8d4','ffffff')]
SOCK=[hexc(x) for x in ('2f64c8','1e468f','5b8ae6')]
BOOT=[hexc(x) for x in ('f0c020','b08810','ffe070')]
def dark(c,k=0.78): return (int(c[0]*k),int(c[1]*k),int(c[2]*k),c[3])
def R(v): return int(round(v))

class Canvas:
    def __init__(s): s.layers=[]
    def part(s,fn,col,far=False,shade=None):
        im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
        c=dark(col[0]) if far else col[0]
        sh=dark(col[1]) if far else col[1]
        if shade is None: shade=True
        if shade:
            tmp=Image.new('RGBA',(S,S),(0,0,0,0)); fn(ImageDraw.Draw(tmp),sh,(0,0))
            # shade offset
            im.alpha_composite(tmp,(0,1)) if False else None
            im.paste(tmp,(1,1),tmp)
        tmp2=Image.new('RGBA',(S,S),(0,0,0,0)); fn(ImageDraw.Draw(tmp2),c,(0,0))
        # clip shade to base shape union offset: keep both
        im.alpha_composite(tmp2)
        s.layers.append(im)
    def render(s):
        img=Image.new('RGBA',(S,S),(0,0,0,0))
        for l in s.layers: img.alpha_composite(l)
        a=img.getchannel('A').point(lambda v:255 if v>0 else 0)
        px=a.load(); out=Image.new('RGBA',(S,S),(0,0,0,0)); op=out.load()
        for y in range(S):
            for x in range(S):
                if px[x,y]==0:
                    for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                        xx,yy=x+dx,y+dy
                        if 0<=xx<S and 0<=yy<S and px[xx,yy]: op[x,y]=OUT;break
        res=Image.new('RGBA',(S,S),(0,0,0,0))
        # shadow
        sh=Image.new('RGBA',(S,S),(0,0,0,0)); ImageDraw.Draw(sh).ellipse([20,57,44,62],fill=(0,0,0,70))
        res.alpha_composite(sh); res.alpha_composite(out); res.alpha_composite(img)
        return res

def seg(p0,p1,w):
    def f(d,c,o):
        d.line([p0,p1],fill=c,width=w)
        r=w/2
        for p in (p0,p1): d.ellipse([p[0]-r+0.5,p[1]-r+0.5,p[0]+r-0.5,p[1]+r-0.5],fill=c)
    return f
def rect(x0,y0,x1,y1,rad=2):
    def f(d,c,o): d.rounded_rectangle([x0,y0,x1,y1],radius=rad,fill=c)
    return f
def ell(x0,y0,x1,y1):
    def f(d,c,o): d.ellipse([x0,y0,x1,y1],fill=c)
    return f

def leg_pts(hip,f,l):
    foot=(hip[0]+f,58-l)
    knee=((hip[0]+foot[0])/2+ (1.5 if f>=0 else 1.0) + (l*0.35), (hip[1]+foot[1])/2 - 1)
    return foot,knee

def side(pose,facing_right=True):
    c=Canvas(); b=pose['bob']; ln=pose['lean']
    hx=32+ln
    hipy=45-b
    # order: far arm, far leg, torso, near leg, near arm, head
    def arm(a,far):
        af,ar=a; sh=(hx-1,34-b)
        ar2=ar*(1.0 if ar<8 else 1.7)
        hand=(sh[0]+af*0.9+(ar2>12)*3, max(5,sh[1]+10-ar2))
        el=((sh[0]+hand[0])/2+(-1.5 if ar<8 else 1), (sh[1]+hand[1])/2+(1 if ar<8 else 0))
        c.part(seg(sh,el,4),SHIRT,far); c.part(seg(el,hand,3),SKIN,far)
        c.part(ell(hand[0]-1.5,hand[1]-1.5,hand[0]+1.5,hand[1]+1.5),SKIN,far,shade=False)
    def leg(L,far):
        f,l=L; hip=(hx-0.5,hipy)
        foot,knee=leg_pts(hip,f,l)
        c.part(seg((hip[0],hip[1]),knee,5),SKIN,far)
        c.part(seg(knee,(foot[0],foot[1]-2),4),SOCK,far)
        c.part(rect(foot[0]-3,foot[1]-2,foot[0]+3.5,foot[1]+1,1),BOOT,far)
    arm(pose['arm'][1],True); leg(pose['leg'][1],True)
    c.part(rect(hx-5,32-b,hx+4,hipy,3),SHIRT)
    c.part(rect(hx-5,hipy-4,hx+4,hipy+2,1),SHORT)
    leg(pose['leg'][0],False)
    hy=22-b
    raised=pose['arm'][0][1]>12
    if not raised: arm(pose['arm'][0],False)
    c.part(ell(hx-8,hy-8,hx+8,hy+8),SKIN)
    # hair: back and top
    def hair(d,col,o):
        d.pieslice([hx-9,hy-9,hx+8,hy+8],150,390,fill=col)
        d.rectangle([hx-9,hy-3,hx-3,hy+3],fill=col)
        d.ellipse([hx-9,hy-6,hx-1,hy+6],fill=col)
    c.part(hair,HAIR)
    c.part(rect(hx+3,hy-1,hx+4,hy+2,0),[OUT,OUT,OUT],shade=False)
    if raised: arm(pose['arm'][0],False)
    img=c.render()
    return img if facing_right else img.transpose(Image.FLIP_LEFT_RIGHT)

def front(pose,back=False):
    c=Canvas(); b=pose['bob']; hipy=45-b
    def arm(side_,a):
        af,ar=a; x=26 if side_<0 else 38
        sh=(x,34-b)
        hand=(x+side_*(2+max(0,ar-6)*0.45), sh[1]+10-ar+abs(af)*0.3)
        el=((sh[0]+hand[0])/2+side_*1.5,(sh[1]+hand[1])/2+(1 if ar<8 else 0))
        c.part(seg(sh,el,4),SHIRT); c.part(seg(el,hand,3),SKIN)
        c.part(ell(hand[0]-1.5,hand[1]-1.5,hand[0]+1.5,hand[1]+1.5),SKIN,shade=False)
    def leg(side_,L):
        f,l=L; x=29 if side_<0 else 35
        l2=l+max(0,f)*0.35
        hip=(x,hipy); foot=(x+side_*(0.5+abs(f)*0.1),58-l2); knee=((hip[0]+foot[0])/2,(hip[1]+foot[1])/2)
        c.part(seg(hip,knee,5),SKIN); c.part(seg(knee,(foot[0],foot[1]-2),4),SOCK)
        c.part(rect(foot[0]-3,foot[1]-2,foot[0]+3,foot[1]+1,1),BOOT)
    # far/near mapping: near leg=right of screen in front view
    leg(-1,pose['leg'][1]); leg(1,pose['leg'][0])
    c.part(rect(26,32-b,38,hipy,3),SHIRT)
    c.part(rect(26,hipy-4,38,hipy+3,1),SHORT)
    arm(-1,pose['arm'][1]); arm(1,pose['arm'][0])
    hy=22-b
    c.part(ell(23,hy-8,41,hy+8),SKIN)
    def hair(d,col,o):
        if back:
            d.ellipse([22,hy-9,42,hy+8],fill=col)
        else:
            d.pieslice([22,hy-9,42,hy+8],180,360,fill=col)
            d.rectangle([22,hy-2,24,hy+1],fill=col); d.rectangle([40,hy-2,42,hy+1],fill=col)
            d.rectangle([24,hy-4,40,hy-2],fill=col)
    c.part(hair,HAIR)
    if not back:
        c.part(rect(28,hy+1,29,hy+3,0),[OUT]*3,shade=False)
        c.part(rect(35,hy+1,36,hy+3,0),[OUT]*3,shade=False)
        c.part(rect(31,hy+5,33,hy+5,0),[(150,70,60,255)]*3,shade=False)
    return c.render()

def P(bob=0,lean=0,leg=((0,0),(0,0)),arm=((0,2),(0,2))): return dict(bob=bob,lean=lean,leg=leg,arm=arm)
def idle(i,n=12):
    t=i/n; b=1 if (0.25<=t<0.75) else 0
    return P(bob=b,arm=((1-b,2),(-1+b,2)))
def run(i,n=8):
    p=2*math.pi*i/n; s=math.sin(p); co=math.cos(p)
    near=(10*s,6*max(0,co)); far=(-10*s,6*max(0,-co))
    return P(bob=R(2*abs(co)),lean=1,leg=(near,far),arm=((-8*s,3),(8*s,3)))
def kick(i,n=8):
    f=[0,-4,-8,-9,9,11,6,2][i]; l=[0,1,2,1,3,5,3,0][i]
    lean=[0,0,-1,0,2,2,1,0][i]
    return P(bob=0,lean=lean,leg=((f,l),(0,0)),arm=((-f*0.5,3),(f*0.5,3)))
def celeb(i,n=12):
    t=i/n; b=R(6*abs(math.sin(math.pi*t*1.0)))
    ar=16+R(3*math.sin(2*math.pi*t*2))
    lift=R(3*abs(math.sin(math.pi*t)))
    return P(bob=b,leg=((1,lift),(-1,lift)),arm=((2,ar),(-2,ar)))
ANIMS={'idle':(idle,12),'run':(run,8),'kick':(kick,8),'celebrate':(celeb,12)}
DIRS={'down':lambda p:front(p),'up':lambda p:front(p,True),'right':lambda p:side(p,True),'left':lambda p:side(p,False)}
def frames(a,d):
    fn,n=ANIMS[a]; return [DIRS[d](fn(i,n)) for i in range(n)]
if __name__=='__main__':
    base='/downloads/sample/blue'; os.makedirs(base,exist_ok=True)
    allf={}
    for a in ANIMS:
        for d in DIRS:
            fr=frames(a,d); allf[(a,d)]=fr
            strip=Image.new('RGBA',(S*len(fr),S),(0,0,0,0))
            for i,f in enumerate(fr): strip.paste(f,(i*S,0))
            strip.save(f'{base}/{a}_{d}.png')
    import pickle; pickle.dump({k:[f.tobytes() for f in v] for k,v in allf.items()},open('/tmp/gen/frames.pkl','wb'))
    print('ok')
