import math, os, sys
from PIL import Image
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from gen_v1 import S,SHIRT,SHORT,SOCK,hexc,dark,R
import gen2, gen3, gen4
from gen3 import free, KSHIRT,KSHORT,KSOCK
from gen4 import (CL,CK,READY,kfront,kside,gk_ready,gk_catch,gk_punch,kick_d,slide_d,front_idle,side_idle,slide_front_curve)
P=gen2.P
IDLE0=gen2.idle(0)
DIRS=['down','left','right','up']
def draw(d,pose):
    return {'right':lambda:gen2.side(pose,True),'left':lambda:gen2.side(pose,False),'down':lambda:gen2.front(pose),'up':lambda:gen2.front(pose,True)}[d]()
def wrap(fn): # pose-fn -> (d,i)->image
    return lambda d,i: draw(d,fn(i))
def rest(i,cut,fn): return IDLE0 if i>=cut else fn(i)
# ---------------- outfield, pose based
def dribble(i):
    p=2*math.pi*i/8; s=math.sin(p); co=math.cos(p)
    return P(bob=R(abs(co)),lean=2,leg=((6*s,3*max(0,co)),(-6*s,3*max(0,-co))),arm=((-25*s,55),(25*s,55)))
def walk(i):
    p=2*math.pi*i/8; s=math.sin(p); co=math.cos(p)
    return P(bob=0,lean=0,leg=((4*s,2*max(0,co)),(-4*s,2*max(0,-co))),arm=((-18*s,20),(18*s,20)))
def pass_(i):
    if i>=5: return IDLE0
    f=[-4,-8,8,3,0][i]; l=[1,3,3,1,0][i]; k=[-8,-18,20,6,5][i]; ln=[0,-1,1,0,0][i]
    if i==4: return IDLE0
    return P(lean=ln,leg=((f,l),(0,0)),arm=((k,35),(-k,35)))
def trap(i):
    if i>=4: return IDLE0
    f=[2,7,9,5][i]; l=[0,4,6,3][i]; a=[10,25,28,15][i]
    return P(leg=((f,l),(0,0)),arm=((a,30),(-a,30)))
def header(i):
    if i>=5: return IDLE0
    b=[0,3,7,8,3][i]; ln=[0,-2,-2,2,1][i]; lg=[((0,0),(0,0)),((-2,2),(2,2)),((-3,4),(3,3)),((-3,4),(3,3)),((0,1),(0,1))][i]
    a=[10,35,45,45,25][i]
    return P(bob=b,lean=ln,leg=lg,arm=((a,25),(-a,25)))
def juggle(i):
    if i>=4: return IDLE0
    return [P(leg=((3,4),(0,0))),P(),P(leg=((0,0),(3,4))),P(leg=((3,4),(0,0)))][i] if i!=1 else P(arm=((8,20),(-8,20)))
def clap(i):
    if i>=7: return IDLE0
    th=[100,125,100,125,100,125,100][i]; b=[0,1,0,1,0,1,0][i]
    return P(bob=b,arm=((th,20),(th,20)))
def shout(i):
    th=[125,150,125,150,125,150,125,150,125,150,125,150][i]; b=[0,1][i%2]
    return P(bob=b,arm=((th,15),(155-th+95,15)))
def tired(i):
    b=[-1,-1,-1,-2,-2,-2,-2,-2,-2,-1,-1,-1][i]
    return P(bob=b,lean=4,arm=((26,28),(16,28)))
def sad(i):
    b=[-1,-2,-2,-2,-2,-2,-2,-2,-2,-2,-1,-1][i]
    return P(bob=b,lean=1+(i%4==0),arm=((6,3),(-6,3)))
def frustrated(i):
    s=math.sin(2*math.pi*i/6)
    return P(bob=i%2,arm=((100+10*s,90),(100-10*s,90)))
POSE={'dribble':(dribble,8),'walk':(walk,8),'pass':(pass_,6),'trap':(trap,6),'header':(header,8),'juggle':(juggle,12),'clap':(clap,12),'shout':(shout,12),'tired':(tired,12),'sad':(sad,12),'frustrated':(frustrated,12)}
# ---------------- fall / get_up
FALL=[((32,45),-6,((36,58),(28,58)),((-20,30),(20,30))),
 ((30,47),-30,((40,56),(31,57)),((-60,40),(30,50))),
 ((28,52),-62,((45,52),(36,55)),((-80,30),(50,40))),
 ((26,56),-85,((44,48),(36,52)),((-95,20),(70,30))),
 ((26,56),-85,((44,53),(36,55)),((-95,20),(70,30))),
 ((28,52),-65,((42,57),(30,58)),((-70,30),(20,50))),
 ((30,48),-30,((38,58),(28,58)),((-30,40),(10,40))),
 ((32,46),-8,((36,58),(28,58)),((-8,20),(8,20)))]
FF=[(0,0),(3,1),(8,4),(10,6),(10,6),(7,3),(3,1),(1,0)]
def fall_d(d,i):
    if d in('right','left'):
        h,a,l,ar=FALL[i]; return free(h,a,l,ar,CL,'side',d=='left')
    return slide_front_curve(FF[i][0],FF[i][1],d=='up')
GU=[3,4,5,5,6,6,7,7]
def getup_d(d,i): return fall_d(d,GU[i])
# ---------------- keeper
def kk(d,h,a,l,ar): return kside(h,a,l,ar,flip=(d=='left'))
LG=((37,58),(27,58))
HOLDS=((50,85),(45,85))
def gk_hold(d,i):
    b=1 if 3<=i<9 else 0
    if d in('right','left'): return kk(d,(32,46+b),10,LG,HOLDS)
    return kfront([(3,9,1),(3,9,1)],crouch=1+b,back=(d=='up'))
PUNT=[((32,46),8,LG,((55,85),(50,85))),((31,46),4,((30,54),(27,58)),((55,85),(50,85))),
 ((32,46),12,((46,40),(27,58)),((70,40),(40,50))),((33,46),16,((44,44),(27,58)),((60,40),(30,50))),((32,46),10,((38,56),(27,58)),((50,30),(40,30)))]
PUNTF=[[(3,9,1),(3,9,1)],[(3,9,1),(3,9,1)],[(8,6,0),(8,6,0)],[(8,6,0),(8,6,0)],[(7,8,0),(7,8,0)]]
def gk_punt(d,i):
    if i>=5: return gk_ready(d,0)
    if d in('right','left'): h,a,l,ar=PUNT[i]; return kk(d,h,a,l,ar)
    return kfront(PUNTF[i],crouch=1,lift=[0,0,6,5,2][i],back=(d=='up'))
THROW=[((32,46),10,LG,HOLDS),((31,46),6,LG,((-100,20),(40,70))),((32,46),12,LG,((-60,10),(40,70))),
 ((33,46),18,LG,((60,10),(40,50))),((34,46),14,LG,((130,10),(40,40))),((32,46),10,LG,((70,40),(48,35)))]
THF=[[(3,9,1),(3,9,1)],[(8,-6,0),(3,9,1)],[(6,-14,0),(5,8,0)],[(5,-8,0),(6,8,0)],[(7,8,0),(7,8,0)],[(7,8,0),(7,8,0)]]
def gk_throw(d,i):
    if i>=5: return gk_ready(d,0)
    if d in('right','left'): h,a,l,ar=THROW[i]; return kk(d,h,a,l,ar)
    return kfront(THF[i],crouch=[1,1,0,0,1][i],back=(d=='up'))
# ---------------- registry
OUT_FN={'kick':(kick_d,8),'slide_tackle':(slide_d,10),'fall':(fall_d,8),'get_up':(getup_d,8),
        'idle':(lambda d,i:draw(d,gen2.idle(i)),12),'run':(lambda d,i:draw(d,gen2.run(i)),8),'celebrate':(lambda d,i:draw(d,gen2.celeb(i)),12)}
for k,(fn,n) in POSE.items(): OUT_FN[k]=(wrap(fn),n)
KEEP_FN={'gk_ready':(gk_ready,12),'gk_hold':(gk_hold,12),'gk_catch':(gk_catch,6),'gk_punch':(gk_punch,6),'gk_punt':(gk_punt,8),'gk_throw':(gk_throw,8)}
def build_strips():
    base={}
    for a,(fn,n) in OUT_FN.items():
        for d in DIRS:
            st=Image.new('RGBA',(S*n,S),(0,0,0,0))
            for i in range(n): st.paste(fn(d,i),(i*S,0))
            base[(a,d)]=st
    kb={}
    for a,(fn,n) in KEEP_FN.items():
        for d in DIRS:
            st=Image.new('RGBA',(S*n,S),(0,0,0,0))
            for i in range(n): st.paste(fn(d,i),(i*S,0))
            kb[(a,d)]=st
    return base,kb
# ---------------- palette swap
def ramp(a,b,c): return [hexc(a),hexc(b),hexc(c)]
def colmap(src,dst):
    m={}
    for s,t in zip(src,dst):
        m[s]=t; m[dark(s)]=dark(t)
    return m
def recolor(img,m,pat=None):
    out=img.copy(); px=out.load()
    for y in range(img.height):
        for x in range(img.width):
            c=px[x,y]
            if c[3]==0: continue
            key=c
            if key in m:
                px[x,y]=m[key]
    return out
def recolor_pat(img,m,m2,mode):
    out=img.copy(); px=out.load(); shirtc=set(m.keys())
    for y in range(img.height):
        for x in range(img.width):
            c=px[x,y]
            if c[3]==0: continue
            fx=(x%S)
            use2=((y//3)%2==0) if mode=='hoops' else ((fx//3)%2==0)
            mm=m2 if use2 else m
            if c in mm: px[x,y]=mm[c]
    return out
KITS={ # shirt ramp, shorts ramp (look1), shorts ramp (look2), pattern ramp
 'blue':(('2f64c8','1e468f','5b8ae6'),('f2f2f2','c4c8d4','ffffff'),('1e468f','143266','2f64c8'),None),
 'yellow':(('f2c230','c4981a','ffe06a'),('2f5fd0','1e3f90','5b8ae6'),('2a2a34','1a1a22','45454f'),None),
 'white':(('e8e8e8','b8bcc8','ffffff'),('2f5fd0','1e3f90','5b8ae6'),('2a2a34','1a1a22','45454f'),None),
 'hoops':(('2e9b5a','1f7040','52c27e'),('f2f2f2','c4c8d4','ffffff'),('1f7040','155030','2e9b5a'),('f2f2f2','c4c8d4','ffffff')),
 'sky':(('6cc4f0','4a9cc8','9ae0ff'),('f2f2f2','c4c8d4','ffffff'),('1e468f','143266','2f64c8'),None),
 'stripes':(('2a2a30','15151a','45454f'),('2a2a30','15151a','45454f'),('f2f2f2','c4c8d4','ffffff'),('f2f2f2','c4c8d4','ffffff')),
 'orange':(('f07a28','b85a18','ff9c50'),('f2f2f2','c4c8d4','ffffff'),('2a2a34','1a1a22','45454f'),None),
 'red':(('c8323a','8f1f27','e85a62'),('f2f2f2','c4c8d4','ffffff'),('2a2a34','1a1a22','45454f'),None),
}
KEEPERS={'keeper_pink':None,
 'keeper_black':(('3a3a44','24242c','55555f'),('e86a28','b04a18','ff9c50')),
 'keeper_lime':(('9ad838','6ea01c','c4f060'),('2a2a34','1a1a22','45454f')),
 'keeper_orange':(('f08a28','b85e18','ffa850'),('2a2a34','1a1a22','45454f'))}
def kit_strips(base,name,look):
    sh,so,so2,pat=KITS[name]; shorts=so if look==1 else so2
    m=colmap(SHIRT,ramp(*sh)); m.update(colmap(SHORT,ramp(*shorts)))
    if pat:
        m2=colmap(SHIRT,ramp(*pat)); m2.update(colmap(SHORT,ramp(*shorts)))
        return {k:recolor_pat(v,m,m2,'hoops' if name=='hoops' else 'stripes') for k,v in base.items()}
    return {k:recolor(v,m) for k,v in base.items()}
def write(strips,folder):
    os.makedirs(folder,exist_ok=True)
    for (a,d),im in strips.items(): im.save(f'{folder}/{a}_{d}.png')
if __name__=='__main__':
    root=sys.argv[1] if len(sys.argv)>1 else '/downloads/sample/full'
    base,kb=build_strips()
    write(base,f'{root}/_base_blue'); write(kb,f'{root}/_base_keeper_pink')
    print('base done',len(base),len(kb))

def full(root):
    base,kb=build_strips()
    import shutil
    for k in list(KITS):
        for look in (1,2):
            write(kit_strips(base,k,look),f'{root}/{k}_player_{look}')
    write(kit_strips(base,'blue',1),f'{root}/blue')
    # keepers
    names=[a for (a,d) in base]; names=sorted(set(names))
    for kn,spec in KEEPERS.items():
        m_out=colmap(SHIRT,KSHIRT); m_out.update(colmap(SHORT,KSHORT))
        strips={}
        for (a,d),im in base.items():
            if a in ('idle',): continue
            strips[(a,d)]=recolor(im,m_out)
        for (a,d),im in kb.items(): strips[(a,d)]=im
        for d in DIRS: strips[('idle',d)]=kb[('gk_ready',d)]
        for d in DIRS: strips[('gk_dive',d)]=Image.new('RGBA',(S*10,S),(0,0,0,0)) if False else base[('slide_tackle',d)]
        if spec:
            sh,so=spec; m=colmap(KSHIRT,ramp(*sh)); m.update(colmap(KSHORT,ramp(*so)))
            strips={k:recolor(v,m) for k,v in strips.items()}
        write(strips,f'{root}/{kn}')
    # coaches
    for cn,(sh,so) in {'coach':(('3a3a44','24242c','55555f'),('2a2a34','1a1a22','45454f')),'coach_2':(('c8c8d0','9a9aa4','e8e8f0'),('2a2a34','1a1a22','45454f'))}.items():
        m=colmap(SHIRT,ramp(*sh)); m.update(colmap(SHORT,ramp(*so)))
        write({k:recolor(v,m) for k,v in base.items()},f'{root}/{cn}')
    # gk_dive strip frames must be 10 wide for config: base slide_tackle is 10 frames, ok
if __name__=='__main__' and len(sys.argv)>2 and sys.argv[2]=='full':
    full(sys.argv[1]+'/cast'); print('full done')
