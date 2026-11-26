import math, os
from PIL import Image, ImageDraw
from gen_v1 import (S,OUT,SKIN,HAIR,SHIRT,SHORT,SOCK,BOOT,hexc,dark,R,Canvas,seg,rect,ell)
def pol(a,L): return (math.sin(math.radians(a))*L, math.cos(math.radians(a))*L)
def ik(hip,foot,a,b,fwd=1):
    dx,dy=foot[0]-hip[0],foot[1]-hip[1]; d=math.hypot(dx,dy); d=max(0.01,min(d,a+b-0.01))
    t=math.atan2(dy,dx); cosA=(a*a+d*d-b*b)/(2*a*d); A=math.acos(max(-1,min(1,cosA)))
    ang=t-fwd*A
    return (hip[0]+a*math.cos(ang),hip[1]+a*math.sin(ang))
def side(pose,facing_right=True):
    c=Canvas(); b=pose['bob']; ln=pose['lean']; hx=32+ln; hipy=45-b
    def arm(a,far):
        th,bend=a; sh=(hx-0.5,34-b)
        k=1.5 if th>100 else 1.0
        e=pol(th,6*k); el=(sh[0]+e[0],sh[1]+e[1]); h=pol(th+bend,5*k); hand=(el[0]+h[0],el[1]+h[1])
        hand=(hand[0],max(4,hand[1]))
        c.part(seg(sh,el,4),SHIRT,far); c.part(seg(el,hand,3),SKIN,far)
        c.part(ell(hand[0]-1.5,hand[1]-1.5,hand[0]+1.5,hand[1]+1.5),SKIN,far,shade=False)
    def leg(L,far):
        f,l=L; hip=(hx-0.5,hipy); foot=(hip[0]+f,58-l)
        knee=ik(hip,(foot[0],foot[1]-2),7.5,7.5,1)
        c.part(seg(hip,knee,5),SKIN,far); c.part(seg(knee,(foot[0],foot[1]-2),4),SOCK,far)
        tilt=pose.get('toe',{}).get(id(L),0)
        c.part(rect(foot[0]-3,foot[1]-2,foot[0]+4,foot[1]+1,1),BOOT,far)
    arm(pose['arm'][1],True); leg(pose['leg'][1],True)
    c.part(rect(hx-5,32-b,hx+4,hipy,3),SHIRT)
    c.part(rect(hx-5,hipy-4,hx+4,hipy+2,1),SHORT)
    leg(pose['leg'][0],False)
    hy=22-b
    raised=pose['arm'][0][0]>100
    if not raised: arm(pose['arm'][0],False)
    c.part(ell(hx-8,hy-8,hx+8,hy+8),SKIN)
    def hair(d,col,o):
        d.pieslice([hx-9,hy-9,hx+8,hy+8],150,390,fill=col)
        d.rectangle([hx-9,hy-3,hx-3,hy+3],fill=col); d.ellipse([hx-9,hy-6,hx-1,hy+6],fill=col)
    c.part(hair,HAIR)
    c.part(rect(hx+3,hy-1,hx+4,hy+2,0),[OUT]*3,shade=False)
    if raised: arm(pose['arm'][0],False)
    img=c.render()
    return img if facing_right else img.transpose(Image.FLIP_LEFT_RIGHT)
def front(pose,back=False):
    c=Canvas(); b=pose['bob']; hipy=45-b
    def arm(sd,a):
        th,bend=a; x=26 if sd<0 else 38; sh=(x,34-b)
        spread=sd*(1+ (7*math.sin(math.radians(min(th,160))) if th>100 else 0))
        hand=(x+spread*(1 if th>100 else 1)+sd*1.5, sh[1]+10*math.cos(math.radians(min(th,170)))+ (4 if th<=100 else 0)*0)
        hand=(hand[0],max(4,hand[1]))
        el=((sh[0]+hand[0])/2+sd*1.5,(sh[1]+hand[1])/2)
        c.part(seg(sh,el,4),SHIRT); c.part(seg(el,hand,3),SKIN)
        c.part(ell(hand[0]-1.5,hand[1]-1.5,hand[0]+1.5,hand[1]+1.5),SKIN,shade=False)
    def leg(sd,L):
        f,l=L; x=29 if sd<0 else 35
        hip=(x,hipy); foot=(x+sd*(0.5+abs(f)*0.1),58-l-max(0,f)*0.2)
        knee=((hip[0]+foot[0])/2+sd*(0.8+0.12*l),(hip[1]+foot[1])/2)
        big=1 if (f>5 and l>2) else 0
        c.part(seg(hip,knee,5),SKIN); c.part(seg(knee,(foot[0],foot[1]-2),4),SOCK)
        c.part(rect(foot[0]-3-big,foot[1]-2-big,foot[0]+3+big,foot[1]+1,1),BOOT)
    leg(-1,pose['leg'][1]); leg(1,pose['leg'][0])
    c.part(rect(26,32-b,38,hipy,3),SHIRT); c.part(rect(26,hipy-4,38,hipy+3,1),SHORT)
    arm(-1,pose['arm'][1]); arm(1,pose['arm'][0])
    hy=22-b
    c.part(ell(23,hy-8,41,hy+8),SKIN)
    def hair(d,col,o):
        if back: d.ellipse([22,hy-9,42,hy+8],fill=col)
        else:
            d.pieslice([22,hy-9,42,hy+8],180,360,fill=col)
            d.rectangle([22,hy-2,24,hy+1],fill=col); d.rectangle([40,hy-2,42,hy+1],fill=col); d.rectangle([24,hy-4,40,hy-2],fill=col)
    c.part(hair,HAIR)
    if not back:
        c.part(rect(28,hy+1,29,hy+3,0),[OUT]*3,shade=False); c.part(rect(35,hy+1,36,hy+3,0),[OUT]*3,shade=False)
        c.part(rect(31,hy+5,33,hy+5,0),[(150,70,60,255)]*3,shade=False)
    return c.render()
def P(bob=0,lean=0,leg=((0,0),(0,0)),arm=((4,12),(-4,12))): return dict(bob=bob,lean=lean,leg=leg,arm=arm)
def idle(i,n=12):
    t=i/n; b=1 if 0.25<=t<0.75 else 0
    return P(bob=b,arm=((5-b*2,14),(-5+b*2,14)))
def run(i,n=8):
    p=2*math.pi*i/n; s=math.sin(p); co=math.cos(p)
    near=(10*s,6*max(0,co)); far=(-10*s,6*max(0,-co))
    return P(bob=R(2*abs(co)),lean=1,leg=(near,far),arm=((-48*s,70),(48*s,70)))
def kick(i,n=8):
    # wind-up (foot back, knee high), strike (foot forward & up), follow-through
    f=[0,-5,-10,-11,10,13,8,2][i]; l=[0,2,5,4,5,8,4,0][i]
    lean=[0,0,-1,-1,1,2,1,0][i]; bob=[0,0,0,0,0,1,0,0][i]
    # arms counter: kicking leg forward -> near arm back, far arm forward
    k=[0,-10,-25,-30,35,45,25,5][i]
    return P(bob=bob,lean=lean,leg=((f,l),(0,0)),arm=((k,40),(-k,40)))
def celeb(i,n=12):
    t=i/n; b=R(6*abs(math.sin(math.pi*t)))
    th=128+R(12*math.sin(2*math.pi*t*2)); lift=R(3*abs(math.sin(math.pi*t)))
    return P(bob=b,leg=((1,lift),(-1,lift)),arm=((th,10),(th,10)))
ANIMS={'idle':(idle,12),'run':(run,8),'kick':(kick,8),'celebrate':(celeb,12)}
DIRS={'down':lambda p:front(p),'up':lambda p:front(p,True),'right':lambda p:side(p,True),'left':lambda p:side(p,False)}
def frames(a,d):
    fn,n=ANIMS[a]; return [DIRS[d](fn(i,n)) for i in range(n)]
def export(base):
    os.makedirs(base,exist_ok=True)
    for a in ANIMS:
        for d in DIRS:
            fr=frames(a,d); strip=Image.new('RGBA',(S*len(fr),S),(0,0,0,0))
            for i,f in enumerate(fr): strip.paste(f,(i*S,0))
            strip.save(f'{base}/{a}_{d}.png')
if __name__=='__main__':
    export('/downloads/sample/blue_v2')
    G=(70,150,70,255)
    z=Image.new('RGBA',(8*192,192*3),G)
    for k,a in enumerate(['run','kick','celebrate']):
        for i,f in enumerate(frames(a,'right')[:8]): z.alpha_composite(f.resize((192,192),Image.NEAREST),(i*192,k*192))
    z.save('/downloads/sample/v2_side_zoom.png')
    z=Image.new('RGBA',(8*128,128*3),G)
    for k,a in enumerate(['run','kick','celebrate']):
        for i,f in enumerate(frames(a,'down')[:8]): z.alpha_composite(f.resize((128,128),Image.NEAREST),(i*128,k*128))
    z.save('/downloads/sample/v2_front_zoom.png')
